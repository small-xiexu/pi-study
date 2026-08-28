package com.xiexu.pistudy.rpc;

import java.util.Objects;

/**
 * Prompt 运行结果
 *
 * 职责：保存 RPC 接收状态、最终 Assistant 文字和有界错误信息
 *
 * @author xiexu
 */
public final class PromptRunResult {

    private final PromptRunStatus status;
    private final boolean responseAccepted;
    private final boolean settled;
    private final String finalText;
    private final String error;
    private final Integer exitCode;

    /**
     * 创建 Prompt 运行结果
     *
     * @param status 结果状态
     * @param responseAccepted 命令是否已接收
     * @param settled Agent 是否已收尾
     * @param finalText 最终 Assistant 文字
     * @param error 有界错误信息
     * @param exitCode 子进程退出码
     */
    private PromptRunResult(PromptRunStatus status,
                            boolean responseAccepted,
                            boolean settled,
                            String finalText,
                            String error,
                            Integer exitCode) {
        this.status = Objects.requireNonNull(status, "status");
        this.responseAccepted = responseAccepted;
        this.settled = settled;
        this.finalText = finalText == null ? "" : finalText;
        this.error = error;
        this.exitCode = exitCode;
    }

    /**
     * 创建成功结果
     *
     * @param finalText 最终 Assistant 文字
     * @return 成功结果
     */
    public static PromptRunResult success(String finalText) {
        return new PromptRunResult(PromptRunStatus.SUCCESS, true, true, finalText, null, null);
    }

    /**
     * 创建接收前拒绝结果
     *
     * @param error 拒绝原因
     * @return 拒绝结果
     */
    public static PromptRunResult rejected(String error) {
        return new PromptRunResult(PromptRunStatus.REJECTED, false, false, "", error, null);
    }

    /**
     * 创建接收后运行失败结果
     *
     * @param finalText 最终 Assistant 文字
     * @param error 运行失败原因
     * @return 运行失败结果
     */
    public static PromptRunResult runtimeFailure(String finalText, String error) {
        return new PromptRunResult(PromptRunStatus.RUNTIME_FAILURE, true, true, finalText, error, null);
    }

    /**
     * 创建子进程提前退出结果
     *
     * @param responseAccepted 命令是否已接收
     * @param exitCode 子进程退出码
     * @return 进程退出结果
     */
    public static PromptRunResult processExited(boolean responseAccepted, int exitCode) {
        return new PromptRunResult(PromptRunStatus.PROCESS_EXITED,
                responseAccepted,
                false,
                "",
                "RPC process exited before the run settled",
                exitCode);
    }

    /**
     * 返回结果状态
     *
     * @return 结果状态
     */
    public PromptRunStatus getStatus() {
        return status;
    }

    /**
     * 返回命令是否已接收
     *
     * @return 命令是否已接收
     */
    public boolean isResponseAccepted() {
        return responseAccepted;
    }

    /**
     * 返回 Agent 是否已收尾
     *
     * @return Agent 是否已收尾
     */
    public boolean isSettled() {
        return settled;
    }

    /**
     * 返回最终 Assistant 文字
     *
     * @return 最终 Assistant 文字
     */
    public String getFinalText() {
        return finalText;
    }

    /**
     * 返回有界错误信息
     *
     * @return 有界错误信息
     */
    public String getError() {
        return error;
    }

    /**
     * 返回子进程退出码
     *
     * @return 子进程退出码
     */
    public Integer getExitCode() {
        return exitCode;
    }
}
