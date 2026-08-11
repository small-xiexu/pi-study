import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

/**
 * Coordinates inventory reservation and payment for a small order example.
 *
 * <p>Responsibility: provide deterministic code for the read-only Skill lab.
 *
 * @author xiexu
 */
public final class OrderService {

    private final PaymentGateway paymentGateway;
    private final Set<String> processedOrderIds = new HashSet<>();
    private int availableStock;

    /**
     * Creates the service with its payment dependency and initial stock.
     *
     * @param paymentGateway payment dependency
     * @param availableStock initial stock count
     */
    public OrderService(PaymentGateway paymentGateway, int availableStock) {
        this.paymentGateway = Objects.requireNonNull(paymentGateway, "paymentGateway");
        if (availableStock < 0) {
            throw new IllegalArgumentException("availableStock must not be negative");
        }
        this.availableStock = availableStock;
    }

    /**
     * Reserves stock and charges a new order.
     *
     * <p>Callers must use the same quantity and amount when retrying an existing order identifier.
     *
     * @param orderId order identifier
     * @param quantity requested quantity
     * @param amount payment amount
     * @return true when the order is accepted
     */
    public boolean createOrder(String orderId, int quantity, BigDecimal amount) {
        Objects.requireNonNull(orderId, "orderId");
        Objects.requireNonNull(amount, "amount");
        String normalizedOrderId = orderId.trim();
        if (normalizedOrderId.isEmpty() || quantity <= 0 || amount.signum() <= 0) {
            throw new IllegalArgumentException("Invalid order input");
        }
        if (processedOrderIds.contains(normalizedOrderId)) {
            return true;
        }
        if (availableStock < quantity) {
            return false;
        }

        availableStock -= quantity;
        paymentGateway.charge(normalizedOrderId, amount);
        processedOrderIds.add(normalizedOrderId);
        return true;
    }

    /**
     * Returns the current stock visible to callers.
     *
     * @return current stock count
     */
    public int getAvailableStock() {
        return availableStock;
    }

    /**
     * Charges payments for accepted orders.
     *
     * @author xiexu
     */
    public interface PaymentGateway {

        /**
         * Charges one order.
         *
         * @param orderId order identifier
         * @param amount payment amount
         */
        void charge(String orderId, BigDecimal amount);
    }
}
