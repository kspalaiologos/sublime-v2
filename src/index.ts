
// Copyleft (C) Kamila Szewczyk, 2020.
// All wrongs reserved.

import Discord from 'discord.js'
import chalk from 'chalk'
import fs from 'fs'
import levenshtein from 'js-levenshtein'
import temp from 'temp'
import child from 'child_process'

const client = new Discord.Client()

// XXX: bot.json technically may not exist here, but we're not
// interested in this edge case.
const botConfig = JSON.parse(fs.readFileSync('bot.json').toString())

// TODO: LOADING CODE SNIPPETS FROM ATTACHMENTS?

// Note: restricting brainfuck code size is pointless, because if bfmake can output, optimize
// and preprocess it all in ~2s, then the output file size probably isn't a concern.

const log_prefix = (prefix:string) =>
    (msg:string) =>
        console.log(prefix + msg)

const log_info = log_prefix(chalk.yellowBright(' [ INFO ] '))
const log_warn = log_prefix(chalk.yellowBright(' [ WARN ] '))
const log_ok = log_prefix(chalk.greenBright(' [ OK ] '))

// Prefix prepended to every chunk of executed code.
// A dumb protection against attempts of damaging the environment.

// The bot is expected to be ran as an user without rights to
// modify the environment or read anything beyond it's home directory,
// where the bot files are stored.

// The bot shouldn't have permission to load `bot.json'.

// These all precautions make sure that attempting to exploit this
// bot are pointless.
const PREFIX = '#io=nil;getfenv=nil;package=nil;os=nil;\n'

// A simple unhandled error stub, which lets me know if something
// breaks. I could use logging, but I don't check my vps all that
// often.
const internal_error = (msg:Discord.Message, err:any) => {
    msg.reply('internal error.')

    const author = client.users.cache.get('356107472269869058')

    if(author != null)
        author.send('internal error while executing a command: ' + err)
}

// Return the name of a temporary file, prepended by `bfcode'.
// A regular expression makes sure we never return an ambiguous
// in terms of extension path.
const temp_name = () =>
    temp.path(undefined, 'bfcode').replace(/\..*/, '')

// Escape code blocks from the output, to make sure one can't quit the preformatted
// text block with carefully crafted output.
const escape_backticks = (str:string) =>
    str.replace('```', '<escaped triple backtick>')

// Return first code block found in the message.
const extract_code = (msg:Discord.Message) =>
    msg.content.match(/```[a-z]*\n([\s\S]*?)\n```/s)

// Strip pings from a message.
const strip_tags = (str:string) =>
    str.replace(/<@![0-9]+>/g, '')

// Strip code blocks from a message.
// This, intentionally, uses a greedy match, which will yeet all the blocks at once.
const strip_code = (str:string) =>
    str.replace(/```.*```/s, '')

// Compile asm2bf code to brainfuck.
// callback statuses:
//  => (any, undefined) - internal error.
//  => (any, string) - error while building brainfuck.
//  => (undefined, string) - brainfuck built.
const asm2bf_to_bf = (code:string, callback:(error:any, code?:string) => void) => {
    const path = temp_name()

    log_ok(`Running as ${path}{.b|.asm}.`)

    const asmFile = `${path}.asm`
    const bfFile = `${path}.b`

    const cleanup = () => {
        fs.unlink(asmFile, x => x)
        fs.unlink(bfFile, x => x)

        // when bfmake is killed forcefully, it may not
        // clean the error logs. We will do it manually.
        fs.readdir('.', (err, files) => {
            if(!err)
                files
                    .filter(f => /error[0-9]+\.log/.test(f))
                    .map(f => fs.unlink(f, x => x))
        })
    }
    
    fs.writeFile(asmFile, PREFIX + code as string, err => {
        if(err) {
            callback(err, undefined)
            return
        }

        // A dirty hack to make sure the user can specify
        // the -t flag, if it applies to the code.
        const flags = code.startsWith(';-t') ? '-t' : ''

        child.exec(`./timeout -m 32 -t 5 bfmake ${flags} ${asmFile}`, (err, stdout) => {
            if(err) {
                callback(err, stdout)
                cleanup()
                return
            }

            fs.readFile(bfFile, 'utf8', (err, data) => {
                callback(err ? err : undefined, err ? undefined : data)
                cleanup()
            })
        })
    })
}

// Run brainfuck. Memory limit of 32M, time limit of 5 seconds. May get
// increased/decreased depending on the dynamics of the bot.
// callback statuses:s
//  => (any, undefined, undefined) - internal error.
//  => (any, undefined, string) - interpreter crashed.
//  => (any, string, string) - the program finished.
const bf_run = (code:string, callback:(error:any, out?:string, err?:string) => void) => {
    const path = temp_name() + '.b'
    fs.writeFile(path, code as string, err => {
        if(err) {
            callback(err, undefined, undefined)
            return
        }
        
        child.exec(`./timeout -m 32 -t 5 bfi ${path}`, (err, stdout, stderr) => {
            callback(err ? err : undefined, err ? undefined : stdout, stderr)
            fs.unlink(path, x => x)
        })
    })
}

// Report the program output (as either 'No output', the output wrapped in a code block, or an attachment).
const report_output = (msg:Discord.Message, code:string, filename:string) =>
    msg.channel.send(
        code.length > botConfig.message_attach_threshold ?
            new Discord.MessageAttachment(Buffer.from(code), filename)
            : code.length != 0 ?
                '```\n' + escape_backticks(code) + '\n```'
                : 'No output.')

// Report the error message to the sender.
const report_error = (msg:Discord.Message, message:string, code:string) =>
    msg.reply(`${message}:\n\`\`\`\n${escape_backticks(code)}\n\`\`\``)

// build brainfuck code from `c'. Albeit c is `string?', c can never be `undefined'.
// Will reply to the message `msg' with the code.
const build_brainfuck = (msg:Discord.Message, c?:string) =>
    asm2bf_to_bf(c as string, (err, code) =>
        code === undefined ?
            internal_error(msg, err)
            : err ?
                report_error(msg, 'Build failed', code)
                : report_output(msg, code, 'code.b')
    )

// Run brainfuck code from `c'. Will reply to `msg'.
const run_brainfuck = (msg:Discord.Message, c?:string) =>
    bf_run(c as string, (err, stdout, stderr) =>
        stderr === undefined ?
            internal_error(msg, err)
            : stdout === undefined ?
                report_error(msg, 'Interpreter crashed', stderr)
                : report_output(msg, stdout, 'output.txt')
    )


// Run asm2bf code from `c'.
const run_asm2bf = (msg:Discord.Message, c?:string) =>
    asm2bf_to_bf(c as string, (err, code) =>
        code === undefined ?
            internal_error(msg, err)
            : err ?
                report_error(msg, 'Build failed', code)
                : run_brainfuck(msg, code)
    )

// a tiny 'tutorial' embed.
const tutorial = (msg:Discord.Message) =>
    msg.channel.send(
        new Discord.MessageEmbed()
            .setTitle('Sublime v2')
            .setColor('#ff69b4')
            .setDescription('Sublime has a basic, built-in NLP. You can issue commands in plain english. ' +
                            'For example, try pinging me and saying `build brainfuck`, providing some asm2bf code.')
            .setThumbnail((client.user as Discord.User).avatarURL() as string)
            .setURL('https://discord.gg/m4Wcenn')
    )

// Assert that the code parameter to the command handler is passed.
const assert_arity = (handler:(msg:Discord.Message, command?:string) => void) =>
    (msg:Discord.Message, command?:string) => {
        if(command === undefined) {
            log_warn(`no code block in ${msg.author.tag}'s message.`)
            msg.reply('no code block found in your message.')
            return
        }

        handler(msg, command)
    }

// command list. every command has multiple aliases, the called procedure and whether it needs code or not.
const commands = [
    {'names': [
        'build brainfuck', 'build bf', 'bf',
        'compile asm2bf', 'compile bfasm'],
    'proc': assert_arity(build_brainfuck)},
    
    {'names': [
        'run brainfuck', 'run bf',
        'execute bf', 'execute brainfuck'],
    'proc': assert_arity(run_brainfuck)},
    
    {'names': [
        'run asm2bf', 'run bfasm',
        'execute asm2bf', 'execute bfasm'],
    'proc': assert_arity(run_asm2bf)},

    {'names': [
        'help', 'tutorial'],
    'proc': tutorial}
]

const parse = (msg:Discord.Message) => {
    // Extract the message text (the command) and the code attached to the message.
    const text = strip_code(strip_tags(msg.content))
    const code = extract_code(msg)

    // Calculate the proximity of every command's alias to the actual message text.
    const table = commands
        .map(x => x.names
            .map(x => levenshtein(x, text))
            .sort((x, y) => y - x)
            .pop() as number
        )
    
    // Pick the smallest.
    const closest = Math.min(...table)

    // command recognition threshold.
    if(closest > botConfig.command_threshold) {
        log_info('can\'t understand the command.')
        msg.reply('sorry, I don\'t understand.')
        return
    }

    const command = commands[table.indexOf(closest)]

    log_info(`Processing the message as '${command.names[0]}'-alike.`)
    command.proc(msg, code != null ? code[1] : undefined)
}

client.on('ready', () => 
    client.user != null && log_ok(`Logged in as ${client.user.tag}`)
)

client.on('message', (msg) =>
    (!msg.author.bot                               // discard messages written by other bots.
    && (msg.guild == null                          // if guild is unspecified (= we've been DM'ed), or
        || (msg.mentions.members != null           // we have been mentioned
            && client.user != null
            && msg.mentions.members.filter(        // if the mentions list contains our bot
                x => x.user.id == client.user?.id
            ).size >= 1)))                         // one or more times
        && parse(msg)                              // then parse as command
)

client.login(botConfig.token)
