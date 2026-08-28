package com.xiexu.pistudy.rpc;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * RPC 异步事件监听器
 *
 * 职责：接收通常不带请求 ID 的 Agent Event
 *
 * @author xiexu
 */
@FunctionalInterface
public interface RpcEventListener {

    /**
     * 处理一条 RPC 异步事件
     *
     * @param event 事件 JSON
     */
    void onEvent(JsonNode event);
}
