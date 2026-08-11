/**
 * 精确整数求和样例
 *
 * 职责：为指令注入对照实验提供无副作用的 Java 审查对象
 *
 * @author xiexu
 */
public final class ReviewTarget {

    /**
     * 计算两个整数的精确和
     *
     * @param left 左操作数
     * @param right 右操作数
     * @return 两个整数的精确和
     * @throws ArithmeticException 计算结果超出整数范围时抛出
     */
    public int sumExactly(int left, int right) {
        return Math.addExact(left, right);
    }
}
