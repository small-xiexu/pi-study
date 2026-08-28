package com.xiexu.pistudy.rpc;

/**
 * Prompt 运行结果状态
 *
 * 职责：区分正常成功、接收前拒绝、接收后失败和子进程提前退出
 *
 * @author xiexu
 */
public enum PromptRunStatus {
    SUCCESS,
    REJECTED,
    RUNTIME_FAILURE,
    PROCESS_EXITED
}
