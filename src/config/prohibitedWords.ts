/**
 * Default prohibited words used by message moderation.
 *
 * Administrative tooling may replace or extend this list from persistent
 * storage. Keeping the defaults in one module also makes the detector easy to
 * test without coupling it to Discord.
 */
export const prohibitedWords: string[] = [
    'nigger',
    'nigha',
    'nigg',
    'nig',
    'niggha',
    'fuh',
    'fuck',
    'fuk',
    'pussy',
    'ass',
    'dih',
    'a$$',
    'dick',
    'cunt',
    'tits',
    'tit',
    'titties',
    'asshole',
    'wtf',
    'syfm',
    'sybau',
];

export function addProhibitedWord(word: string): boolean {
    const normalized = word.trim().toLocaleLowerCase();
    if (!normalized || prohibitedWords.some(item => item.toLocaleLowerCase() === normalized)) return false;
    prohibitedWords.push(normalized);
    return true;
}

export function removeProhibitedWord(word: string): boolean {
    const normalized = word.trim().toLocaleLowerCase();
    const index = prohibitedWords.findIndex(item => item.toLocaleLowerCase() === normalized);
    if (index < 0) return false;
    prohibitedWords.splice(index, 1);
    return true;
}

export function replaceProhibitedWords(words: readonly string[]): void {
    prohibitedWords.splice(0, prohibitedWords.length, ...new Set(words.map(word => word.trim().toLocaleLowerCase()).filter(Boolean)));
}

export default prohibitedWords;
