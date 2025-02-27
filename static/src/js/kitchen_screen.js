/** @odoo-module */

import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
const { Component, onWillStart, useState, onMounted } = owl;
import { useService } from "@web/core/utils/hooks";

class kitchen_screen_dashboard extends Component {
    setup() {
        super.setup();
        this.busService = this.env.services.bus_service;
        this.notificationService = this.env.services.notification;
        
        // Add channel for order notifications
        this.busService.addChannel("pos_order_created");
        
        onWillStart(() => {
            // Listen for bus notifications
            this.busService.addEventListener('notification', this.onPosOrderCreation.bind(this));
        });
        
        // Initialize services
        this.action = useService("action");
        this.rpc = this.env.services.rpc;
        this.orm = useService("orm");
        
        // Initialize state
        this.state = useState({
            order_details: [],
            shop_id: [],
            stages: 'draft',
            draft_count: 0,
            waiting_count: 0,
            ready_count: 0,
            lines: []
        });
        
        // Get shop ID from context or session storage
        let session_shop_id;
        if (this.props.action.context.default_shop_id) {
            sessionStorage.setItem('shop_id', this.props.action.context.default_shop_id);
            this.shop_id = this.props.action.context.default_shop_id;
        } else {
            session_shop_id = sessionStorage.getItem('shop_id');
            this.shop_id = parseInt(session_shop_id, 10) || 0;
        }
        
        console.log("Kitchen screen initialized with shop_id:", this.shop_id);
        
        // Load initial data
        this.loadOrderDetails();
        
        // Set up refresh interval (every 30 seconds)
        setInterval(() => this.loadOrderDetails(), 30000);
    }

    // Fix any missing order statuses
    fixOrderStatuses() {
        if (this.state.order_details && this.state.order_details.length > 0) {
            for (const order of this.state.order_details) {
                // Convert false, null, undefined to 'draft'
                if (!order.order_status) {
                    console.log(`Fixing missing status for order #${order.id} (${order.name})`);
                    order.order_status = 'draft';
                }
            }
        }
        
        if (this.state.lines && this.state.lines.length > 0) {
            for (const line of this.state.lines) {
                // Convert false, null, undefined to 'draft'
                if (!line.order_status) {
                    console.log(`Fixing missing status for line #${line.id}`);
                    line.order_status = 'draft';
                }
            }
        }
    }

    async loadOrderDetails() {
        try {
            console.log("Loading kitchen orders for shop:", this.shop_id);
            const result = await this.orm.call("pos.order", "get_details", ["", this.shop_id, ""]);
            console.log("Kitchen orders loaded:", result);
            
            if (result) {
                if (!result.orders || result.orders.length === 0) {
                    console.log("No orders found for this kitchen screen");
                    this.notificationService.add(_t("No orders found for this kitchen. Check your configuration."), {
                        type: "warning",
                    });
                }
                
                // Debug each order's status
                if (result.orders) {
                    console.log("Order statuses:");
                    for (const order of result.orders) {
                        console.log(`Order #${order.id} (${order.name}): status=${order.order_status}, config_id=${order.config_id[0]}`);
                        // Set default status if missing
                        if (!order.order_status) {
                            console.log(`Setting default 'draft' status for order #${order.id}`);
                            order.order_status = 'draft';
                        }
                    }
                }
                
                this.state.order_details = result.orders || [];
                this.state.lines = result.order_lines || [];
                this.state.shop_id = this.shop_id;
                
                // Fix any orders with missing status
                this.fixOrderStatuses();
                
                this.updateOrderCounts();
            }
        } catch (error) {
            console.error("Error loading kitchen orders:", error);
            this.notificationService.add(_t("Error loading kitchen orders: ") + error.message, {
                type: "danger",
            });
        }
    }

    updateOrderCounts() {
        // Count draft orders (including cases where status is false/null/undefined)
        const draftOrders = this.state.order_details.filter(
            order => (order.order_status === 'draft' || !order.order_status) && 
                    order.config_id[0] === this.state.shop_id
        );
        this.state.draft_count = draftOrders.length;
        console.log(`Found ${draftOrders.length} draft orders`, draftOrders.map(o => o.id));
        
        // Count waiting orders
        const waitingOrders = this.state.order_details.filter(
            order => order.order_status === 'waiting' && order.config_id[0] === this.state.shop_id
        );
        this.state.waiting_count = waitingOrders.length;
        console.log(`Found ${waitingOrders.length} waiting orders`, waitingOrders.map(o => o.id));
        
        // Count ready orders
        const readyOrders = this.state.order_details.filter(
            order => order.order_status === 'ready' && order.config_id[0] === this.state.shop_id
        );
        this.state.ready_count = readyOrders.length;
        console.log(`Found ${readyOrders.length} ready orders`, readyOrders.map(o => o.id));
        
        console.log("Order counts updated:", {
            draft: this.state.draft_count,
            waiting: this.state.waiting_count,
            ready: this.state.ready_count
        });
    }

    // Handle notifications when an order is created or edited
    onPosOrderCreation(message) {
        console.log("Received bus notification:", message);
        const payload = message.detail && message.detail[0] && message.detail[0].payload;
        
        if (payload && payload.message === "pos_order_created" && payload.res_model === "pos.order") {
            console.log("Reloading kitchen orders after notification");
            this.loadOrderDetails();
        }
    }

    // Cancel order
    async cancel_order(e) {
        const input_id = $("#" + e.target.id).val();
        console.log("Cancelling order:", input_id);
        
        try {
            await this.orm.call("pos.order", "order_progress_cancel", [Number(input_id)]);
            const current_order = this.state.order_details.find(order => order.id == input_id);
            if (current_order) {
                current_order.order_status = 'cancel';
                this.updateOrderCounts();
            }
        } catch (error) {
            console.error("Error cancelling order:", error);
            this.notificationService.add(_t("Error cancelling order"), {
                type: "danger",
            });
        }
    }
    
    // Accept order
    async accept_order(e) {
        const input_id = $("#" + e.target.id).val();
        console.log("Accepting order:", input_id);
        
        // Apply ScrollReveal animation if available
        if (window.ScrollReveal) {
            ScrollReveal().reveal("#" + e.target.id, {
                delay: 1000,
                duration: 2000,
                opacity: 0,
                distance: "50%",
                origin: "top",
                reset: true,
                interval: 600,
            });
        }
        
        try {
            await this.orm.call("pos.order", "order_progress_draft", [Number(input_id)]);
            const current_order = this.state.order_details.find(order => order.id == input_id);
            if (current_order) {
                current_order.order_status = 'waiting';
                this.updateOrderCounts();
            }
        } catch (error) {
            console.error("Error accepting order:", error);
            this.notificationService.add(_t("Error accepting order"), {
                type: "danger",
            });
        }
    }
    
    // Set stage to ready (completed orders)
    ready_stage(e) {
        console.log("Switching to ready stage");
        this.state.stages = 'ready';
    }
    
    // Set stage to waiting (in-progress orders)
    waiting_stage(e) {
        console.log("Switching to waiting stage");
        this.state.stages = 'waiting';
    }
    
    // Set stage to draft (new orders)
    draft_stage(e) {
        console.log("Switching to draft stage");
        this.state.stages = 'draft';
    }
    
    // Change order status to ready
    async done_order(e) {
        const input_id = $("#" + e.target.id).val();
        console.log("Marking order as done:", input_id);
        
        try {
            await this.orm.call("pos.order", "order_progress_change", [Number(input_id)]);
            const current_order = this.state.order_details.find(order => order.id == input_id);
            if (current_order) {
                current_order.order_status = 'ready';
                this.updateOrderCounts();
            }
        } catch (error) {
            console.error("Error updating order status:", error);
            this.notificationService.add(_t("Error updating order status"), {
                type: "danger",
            });
        }
    }
    
    // Change order line status
    async accept_order_line(e) {
        const input_id = $("#" + e.target.id).val();
        console.log("Toggling order line status:", input_id);
        
        try {
            await this.orm.call("pos.order.line", "order_progress_change", [Number(input_id)]);
            const current_order_line = this.state.lines.find(order_line => order_line.id == input_id);
            if (current_order_line) {
                current_order_line.order_status = current_order_line.order_status === 'ready' ? 'waiting' : 'ready';
            }
        } catch (error) {
            console.error("Error updating order line status:", error);
            this.notificationService.add(_t("Error updating order line status"), {
                type: "danger",
            });
        }
    }
}

kitchen_screen_dashboard.template = 'KitchenCustomDashBoard';
registry.category("actions").add("kitchen_custom_dashboard_tags", kitchen_screen_dashboard);