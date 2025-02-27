/** @odoo-module */
import { patch } from "@web/core/utils/patch";
import { ActionpadWidget } from "@point_of_sale/app/screens/product_screen/action_pad/action_pad";
import { useService } from "@web/core/utils/hooks";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { _t } from "@web/core/l10n/translation";

/**
 * @props partner
 */

patch(ActionpadWidget.prototype, {
    setup() {
        super.setup();
        this.orm = useService("orm");
        this.popup = useService("popup");
    },
    
    get swapButton() {
        return this.props.actionType === "payment" && this.pos.config.module_pos_restaurant;
    },
    
    get currentOrder() {
        return this.pos.get_order();
    },
    
    get swapButtonClasses() {
        return {
            "highlight btn-primary": this.currentOrder?.hasChangesToPrint(),
            altlight: !this.currentOrder?.hasChangesToPrint() && this.currentOrder?.hasSkippedChanges(),
        };
    },

    async submitOrder() {
        console.log("Submit Order called in POS Kitchen Screen");
        if (!this.clicked) {
            this.clicked = true;
            try {
                const currentOrder = this.pos.get_order();
                if (!currentOrder) {
                    console.error("No current order found");
                    return;
                }
                
                console.log("Current order:", currentOrder);
                
                // Original Odoo behavior - print and change last order
                await this.pos.sendOrderInPreparationUpdateLastChange(currentOrder);
                
                // Now handle kitchen screen logic
                const orderlines = currentOrder.get_orderlines();
                if (!orderlines.length) {
                    console.warn("No orderlines in current order");
                    return;
                }
                
                console.log("Order lines:", orderlines);
                
                // Build order lines for kitchen
                const line = [];
                for (const orderline of orderlines) {
                    const product = orderline.get_product();
                    console.log("Processing product:", product.display_name, "Category IDs:", product.pos_categ_ids);
                    
                    line.push([0, 0, {
                        'qty': orderline.get_quantity(),
                        'price_unit': orderline.get_unit_price(),
                        'price_subtotal': orderline.get_price_without_tax(),
                        'price_subtotal_incl': orderline.get_price_with_tax(),
                        'discount': orderline.get_discount(),
                        'product_id': product.id,
                        'tax_ids': [[6, 0, orderline.get_taxes().map(tax => tax.id)]],
                        'full_product_name': product.display_name,
                        'price_extra': orderline.price_extra || 0,
                        'is_cooking': true,
                        'order_status': 'draft', // Explicitly set this to 'draft'
                        'note': orderline.get_note()
                    }]);
                }
                
                // Get date/time info
                const now = new Date();
                const hour = now.getHours().toString();
                const minutes = now.getMinutes().toString();
                
                // Get floor and table info
                let floorName = '';
                let tableId = false;
                
                if (this.pos.config.module_pos_restaurant) {
                    if (currentOrder.table) {
                        tableId = currentOrder.table.id;
                        const floor = this.pos.floors?.find(f => 
                            f.tables?.some(t => t.id === tableId)
                        );
                        
                        if (floor) {
                            floorName = floor.name;
                        }
                    }
                }
                
                // Build the order data - MAKE SURE order_status IS SET
                const orders = [{
                    'pos_reference': currentOrder.name,
                    'amount_total': currentOrder.get_total_with_tax(),
                    'amount_paid': 0,
                    'amount_return': 0,
                    'amount_tax': currentOrder.get_total_tax(),
                    'lines': line,
                    'is_cooking': true,
                    'order_status': 'draft', // EXPLICITLY SET THIS
                    'company_id': this.pos.company.id,
                    'session_id': this.pos.pos_session.id,
                    'hour': hour,
                    'minutes': minutes,
                    'table_id': tableId,
                    'floor': floorName,
                    'config_id': this.pos.config.id
                }];
                
                console.log("Sending kitchen order data:", orders);
                
                // Verify order_status is set
                if (!orders[0].order_status) {
                    console.warn("Warning: order_status was not set, setting to 'draft'");
                    orders[0].order_status = 'draft';
                }
                
                // Send to server
                const result = await this.orm.call(
                    "pos.order", 
                    "get_details", 
                    ["", this.pos.config.id, orders]
                );
                
                console.log("Kitchen order result:", result);
                
                // Confirmation popup
                this.popup.add(ErrorPopup, {
                    title: _t("Order Sent to Kitchen"),
                    body: _t("The order has been sent to the kitchen for preparation."),
                });
                
            } catch (error) {
                console.error("Error submitting order to kitchen:", error);
                this.popup.add(ErrorPopup, {
                    title: _t("Kitchen Order Error"),
                    body: _t("Could not send order to kitchen: " + error.message),
                });
            } finally {
                this.clicked = false;
            }
        }
    },
    
    hasQuantity(order) {
        if (!order) {
            return false;
        } else {
            return (
                order.orderlines.reduce((totalQty, line) => totalQty + line.get_quantity(), 0) > 0
            );
        }
    },
    
    get highlightPay() {
        return (
            super.highlightPay &&
            !this.currentOrder.hasChangesToPrint() &&
            this.hasQuantity(this.currentOrder)
        );
    },
});