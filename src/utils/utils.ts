export const generateCaseNumber = () => {
    return `CASE-${Date.now().toString().slice(-6)}`;
};
