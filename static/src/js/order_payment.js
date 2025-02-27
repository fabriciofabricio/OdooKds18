/** @odoo-module **/

import { Order } from "@point_of_sale/app/store/models";
import { patch } from "@web/core/utils/patch";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
import { _t } from "@web/core/l10n/translation";

/**
 * Patching the Order class to add custom functionality.
 */
patch(Order.prototype, {
    setup(_defaultObj, options) {
        super.setup(...arguments);
        this.orm = options.pos.orm;
        this.popup = options.pos.popup;
        this.kitchen = true;
    },
    /**
     * Override of the pay method to handle payment logic.
     */
    async pay() {
        const order_name = this.pos.selectedOrder.name;
        const self = this;
        
        try {
            console.log("Checking kitchen order status for:", order_name);
            
            const result = await this.orm.call("pos.order", "check_order", ["", order_name]);
            console.log("Kitchen order check result:", result);
            
            if (result && result.category) {
                const title = "No category found for your current order in the kitchen.(" + result.category + ')';
                self.kitchen = false;
                self.popup.add(ErrorPopup, {
                    title: _t(title),
                    body: _t("No food items found for the specified category for this kitchen. Kindly remove the selected food and update the order by clicking the 'Order' button. Following that, proceed with the payment."),
                });
            } else if (result === true) {
                self.kitchen = false;
                self.popup.add(ErrorPopup, {
                    title: _t("Food is not ready"),
                    body: _t("Please Complete all the food first."),
                });
            } else {
                self.kitchen = true;
            }
        } catch (error) {
            console.error("Error checking kitchen order:", error);
            self.popup.add(ErrorPopup, {
                title: _t("Kitchen Order Error"),
                body: _t("Could not verify kitchen order status: " + error.message),
            });
            self.kitchen = false;
        }

        if (!this.orderlines.length) {
            return;
        }

        // Check if any product with tracking doesn't have lots set
        const hasProductsWithoutLots = this.orderlines.some(
            (line) => line.get_product().tracking !== "none" && !line.has_valid_product_lot()
        );
        
        const shouldCheckLots = hasProductsWithoutLots && 
            (this.pos.config.use_existing_lots || this.pos.config.use_create_lots);

        if (shouldCheckLots) {
            const { confirmed } = await this.env.services.popup.add(ConfirmPopup, {
                title: _t("Some Serial/Lot Numbers are missing"),
                body: _t(
                    "You are trying to sell products with serial/lot numbers, but some of them are not set.\nWould you like to proceed anyway?"
                ),
                confirmText: _t("Yes"),
                cancelText: _t("No"),
            });

            if (confirmed && this.kitchen) {
                this.pos.mobileMode = "right"; // Updated for Odoo 18
                this.env.services.pos.showScreen("PaymentScreen");
            }
        } else if (this.kitchen) {
            this.pos.mobileMode = "right"; // Updated for Odoo 18
            this.env.services.pos.showScreen("PaymentScreen");
        }
    }
});