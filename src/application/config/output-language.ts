/** 默认使用 BCP 47 英语标签，保持既有英文输出行为。 */
export const DEFAULT_OUTPUT_LANGUAGE = "en";

const standardLanguageTagPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

/**
 * 规范化并校验 BCP 47 语言标签，例如 `zh-CN`、`en`、`ja` 或 `ko`。
 *
 * @throws 标签不符合运行时支持的 BCP 47 语法时抛出错误。
 */
export const canonicalizeOutputLanguage = (value: string): string => {
    if (!standardLanguageTagPattern.test(value)) {
        throw new Error("Output language tag was invalid.");
    }

    const [language] = Intl.getCanonicalLocales(value);
    if (language === undefined) {
        throw new Error("Output language tag was invalid.");
    }

    return language;
};
