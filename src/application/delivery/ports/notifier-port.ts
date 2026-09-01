/**
 * 通知渠道需要投递的、已完成脱敏的 Markdown 内容。
 */
export interface NotificationMessage {
    markdown: string;
}

/**
 * 向外部协作渠道投递评审摘要的端口。
 */
export interface NotifierPort {
    publish(message: NotificationMessage): Promise<void>;
}
