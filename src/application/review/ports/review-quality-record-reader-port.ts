import type { SanitizedQualityRecord } from "./review-run-record-port.js";

/** 读取已脱敏的质量事件；实现不得把原始 JSON 或错误内容泄露给调用方。 */
export interface ReviewQualityRecordReaderPort {
    readAll(): Promise<SanitizedQualityRecord[]>;
}
