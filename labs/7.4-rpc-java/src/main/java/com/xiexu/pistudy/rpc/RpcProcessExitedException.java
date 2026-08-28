package com.xiexu.pistudy.rpc;

import java.io.IOException;

/**
 * RPC 子进程退出异常
 *
 * 职责：让等待中的普通 Command Response 感知进程提前退出
 *
 * @author xiexu
 */
public class RpcProcessExitedException extends IOException {

    private final int exitCode;

    /**
     * 创建 RPC 子进程退出异常
     *
     * @param exitCode 子进程退出码
     */
    public RpcProcessExitedException(int exitCode) {
        super("RPC process exited before the command completed, code: " + exitCode);
        this.exitCode = exitCode;
    }

    /**
     * 返回子进程退出码
     *
     * @return 子进程退出码
     */
    public int getExitCode() {
        return exitCode;
    }
}
