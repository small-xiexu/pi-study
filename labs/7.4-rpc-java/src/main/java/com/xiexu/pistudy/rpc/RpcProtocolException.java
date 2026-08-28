package com.xiexu.pistudy.rpc;

import java.io.IOException;

/**
 * RPC 协议异常
 *
 * 职责：表示 JSONL framing 或 JSON 记录不符合客户端合同
 *
 * @author xiexu
 */
public class RpcProtocolException extends IOException {

    /**
     * 创建 RPC 协议异常
     *
     * @param message 固定错误说明
     */
    public RpcProtocolException(String message) {
        super(message);
    }

    /**
     * 创建带原因的 RPC 协议异常
     *
     * @param message 固定错误说明
     * @param cause 原始异常
     */
    public RpcProtocolException(String message, Throwable cause) {
        super(message, cause);
    }
}
