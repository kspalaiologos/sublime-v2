
export const manual = [
    {
        'name': 'permagen',
        'data': '**Permagen** (sometimes called the permanent generation) - an area of memory containing temporary registers, storage registers, the flag register and the instruction pointer. The size of permagen can be reduced by disabling first two cells (holding `IP` and `G` registers), by passing `-t` (tiny) flag to `bfmake` and `bfasm` (assuming the program doesn\'t utilize the label system).'
    }, {
        'name': 'stack',
        'data': '**Stack** is the second (in order) memory area following the permagen; it has a fixed, but user definable size. The stack is used by the `#call` macro, it\'s also used to perform floating point operations. The stack pointer is tacit (it\'s not stored anywhere), but the stack contents can be accessed in a relative manner using `sgt` and `spt` (or stack-based relative addresses).'
    }
];
