# -*- coding: utf-8 -*-
#############################################################################
#
#    Cybrosys Technologies Pvt. Ltd.
#
#    Copyright (C) 2024-TODAY Cybrosys Technologies(<https://www.cybrosys.com>)
#    Author: Gokul P I (odoo@cybrosys.com)
#
#    You can modify it under the terms of the GNU LESSER
#    GENERAL PUBLIC LICENSE (LGPL v3), Version 3.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU LESSER GENERAL PUBLIC LICENSE (LGPL v3) for more details.
#
#    You should have received a copy of the GNU LESSER GENERAL PUBLIC LICENSE
#    (LGPL v3) along with this program.
#    If not, see <http://www.gnu.org/licenses/>.
#
#############################################################################
import logging
from odoo import api, fields, models

_logger = logging.getLogger(__name__)

class PosOrder(models.Model):
    """Inheriting the pos order model """
    _inherit = "pos.order"

    order_status = fields.Selection(string="Order Status",
                                    selection=[("draft", "Draft"),
                                               ("waiting", "Cooking"),
                                               ("ready", "Ready"),
                                               ("cancel", "Cancel")],
                                    default='draft',
                                    help='To know the status of order')
    order_ref = fields.Char(string="Order Reference",
                            help='Reference of the order')
    is_cooking = fields.Boolean(string="Is Cooking",
                                help='To identify the order is kitchen orders')
    hour = fields.Char(string="Order Time", readonly=True,
                       help='To set the time of each order')
    minutes = fields.Char(string='Order Minutes')
    floor = fields.Char(string='Floor')

    def write(self, vals):
        """Super the write function for adding order status in vals"""
        message = {
            'res_model': self._name,
            'message': 'pos_order_created'
        }
        self.env["bus.bus"]._sendone('pos_order_created',
                                     "notification",
                                     message)
            
        for order in self:
            if order.order_status == "waiting" and vals.get(
                    "order_status") != "ready":
                vals["order_status"] = order.order_status
            if vals.get("state") and vals[
                "state"] == "paid" and order.name == "/":
                vals["name"] = self._compute_order_name()
                    
        _logger.info(f"Writing to POS order: {vals}")
        return super(PosOrder, self).write(vals)

    @api.model_create_multi
    def create(self, vals_list):
        """Override create function for the validation of the order"""
        message = {
            'res_model': self._name,
            'message': 'pos_order_created'
        }
        self.env["bus.bus"]._sendone('pos_order_created',
                                     "notification",
                                     message)
                                     
        _logger.info(f"Creating POS orders: {vals_list}")
        
        new_vals_list = []
        for vals in vals_list:
            # Skip creating if this is a duplicate
            if 'pos_reference' in vals:
                existing = self.search([("pos_reference", "=", vals["pos_reference"])])
                if existing:
                    _logger.info(f"Order already exists: {vals['pos_reference']}")
                    continue
                    
            # Set name if needed
            if vals.get('order_id') and not vals.get('name'):
                try:
                    config = self.env['pos.order'].browse(
                        vals['order_id']).session_id.config_id
                    if config.sequence_line_id:
                        vals['name'] = config.sequence_line_id._next()
                except Exception as e:
                    _logger.error(f"Error setting order name: {e}")
                    
            if not vals.get('name'):
                vals['name'] = self.env['ir.sequence'].next_by_code('pos.order.line')
                
            new_vals_list.append(vals)
                        
        if not new_vals_list:
            return self.browse()
            
        return super().create(new_vals_list)

    def get_details(self, shop_id, order=None):
        """For getting the kitchen orders for the cook"""
        _logger.info(f"Getting kitchen details for shop_id: {shop_id}, order: {order}")
        
        # Process incoming order data
        if order and len(order) > 0:
            try:
                _logger.info(f"Processing incoming order: {order[0].get('pos_reference', '')}")
                
                # Check for existing order
                existing_orders = self.search([("pos_reference", "=", order[0].get('pos_reference', ''))])
                
                if not existing_orders:
                    _logger.info("Creating new order from POS data")
                    order[0]['order_status'] = 'draft'  # Ensure order status is set
                    order[0]['is_cooking'] = True       # Ensure cooking flag is set
                    new_order = self.create(order)
                    _logger.info(f"New order created: {new_order}")
                else:
                    _logger.info(f"Updating existing order: {existing_orders.name}")
                    
                    # Update order data
                    existing_orders.write({
                        'floor': order[0].get('floor', ''),
                        'hour': order[0].get('hour', ''),
                        'minutes': order[0].get('minutes', ''),
                        'is_cooking': True,
                        'order_status': 'draft'
                    })
                    
                    # Process lines if they exist
                    if 'lines' in order[0] and order[0]['lines']:
                        for line_data in order[0]['lines']:
                            # line_data is [0, 0, {...}] format
                            if len(line_data) == 3 and line_data[0] == 0 and line_data[1] == 0:
                                line_vals = line_data[2]
                                line_vals['order_id'] = existing_orders.id
                                line_vals['is_cooking'] = True
                                line_vals['order_status'] = 'draft'
                                
                                self.env['pos.order.line'].create(line_vals)
            except Exception as e:
                _logger.error(f"Error processing order: {e}")
        
        # Fetch kitchen screen configuration
        kitchen_screen = self.env["kitchen.screen"].sudo().search([("pos_config_id", "=", shop_id)])
        if not kitchen_screen:
            _logger.warning(f"No kitchen screen configuration found for shop_id: {shop_id}")
            return {"orders": [], "order_lines": []}
            
        _logger.info(f"Found kitchen screen with categories: {kitchen_screen.pos_categ_ids.ids}")
        
        # Get all orders for this POS config
        pos_orders = self.search([
            ("is_cooking", "=", True),
            ("config_id", "=", shop_id)
        ], order="date_order desc")
        
        _logger.info(f"Found {len(pos_orders)} orders with is_cooking=True for shop_id={shop_id}")
        
        # Set default status for orders without status
        for order in pos_orders:
            if not order.order_status:
                _logger.info(f"Setting default status 'draft' for order {order.name}")
                order.order_status = 'draft'
        
        # Get all order lines with is_cooking=True for these orders
        pos_order_lines = self.env["pos.order.line"].search([
            ("is_cooking", "=", True),
            ("order_id", "in", pos_orders.ids)
        ])
        
        _logger.info(f"Found {len(pos_order_lines)} order lines with is_cooking=True")
        
        # Set default status for lines without status
        for line in pos_order_lines:
            if not line.order_status:
                _logger.info(f"Setting default status 'draft' for line {line.name}")
                line.order_status = 'draft'
        
        # If no categories are configured, show all orders
        if not kitchen_screen.pos_categ_ids:
            _logger.info("No categories configured, showing all orders")
            filtered_lines = pos_order_lines
        else:
            # Filter lines by product category
            category_ids = kitchen_screen.pos_categ_ids.ids
            filtered_lines = pos_order_lines.filtered(
                lambda line: not line.product_id.pos_categ_ids or  # Include products with no category
                any(categ.id in category_ids for categ in line.product_id.pos_categ_ids)
            )
        
        _logger.info(f"After category filtering: {len(filtered_lines)} order lines")
        
        # Get the orders with all their fields (including order_status)
        orders_data = pos_orders.read()
        
        # Debug order statuses before returning
        for order_data in orders_data:
            _logger.info(f"Order #{order_data['id']} status before return: {order_data.get('order_status')}")
            if not order_data.get('order_status'):
                order_data['order_status'] = 'draft'
                _logger.info(f"Fixed missing status for order #{order_data['id']}")
        
        # Return the data
        return {
            "orders": orders_data, 
            "order_lines": filtered_lines.read()
        }

    def action_pos_order_paid(self):
        """Supering the action_pos_order_paid function for setting its kitchen
        order and setting the order reference"""
        res = super().action_pos_order_paid()
        kitchen_screen = self.env["kitchen.screen"].search(
            [("pos_config_id", "=", self.config_id.id)]
        )
        for order_line in self.lines:
            order_line.is_cooking = True
        if kitchen_screen:
            for line in self.lines:
                line.is_cooking = True
            self.is_cooking = True
            self.order_ref = self.name
        return res

    @api.onchange("order_status")
    def onchange_order_status(self):
        """To set is_cooking false"""
        if self.order_status == "ready":
            self.is_cooking = False

    def order_progress_draft(self):
        """Calling function from js to change the order status"""
        self.order_status = "waiting"
        for line in self.lines:
            if line.order_status != "ready":
                line.order_status = "waiting"

    def order_progress_cancel(self):
        """Calling function from js to change the order status"""
        self.order_status = "cancel"
        for line in self.lines:
            if line.order_status != "ready":
                line.order_status = "cancel"

    def order_progress_change(self):
        """Calling function from js to change the order status"""
        self.order_status = "ready"
        for line in self.lines:
            line.order_status = "ready"

    def check_order(self, order_name):
        """Calling function from js to know status of the order"""
        _logger.info(f"Checking order status for: {order_name}")
        pos_order = self.env['pos.order'].sudo().search(
            [('pos_reference', '=', str(order_name))])
            
        if not pos_order:
            _logger.warning(f"No order found with reference: {order_name}")
            return False
            
        kitchen_order = self.env['kitchen.screen'].sudo().search(
            [('pos_config_id', '=', pos_order.config_id.id)])
            
        if kitchen_order:
            # Check if all product categories are in kitchen screen config
            for line in pos_order.lines:
                for categ in line.product_id.pos_categ_ids:
                    if categ.id not in kitchen_order.pos_categ_ids.ids:
                        _logger.info(f"Category {categ.name} not in kitchen config")
                        return {'category': categ.name}
                    
        if kitchen_order and pos_order:
            _logger.info(f"Order status: {pos_order.order_status}")
            if pos_order.order_status != 'ready':
                return True
            else:
                return False
        else:
            return False

    def check_order_status(self, order_name):
        """Check if kitchen order is ready"""
        _logger.info(f"Checking detailed order status for: {order_name}")
        pos_order = self.env['pos.order'].sudo().search(
            [('pos_reference', '=', str(order_name))])
            
        if not pos_order:
            _logger.warning(f"No order found with reference: {order_name}")
            return True
            
        kitchen_order = self.env['kitchen.screen'].sudo().search(
            [('pos_config_id', '=', pos_order.config_id.id)])
            
        # Check if all categories are in kitchen screen config
        for line in pos_order.lines:
            for categ in line.product_id.pos_categ_ids:
                if categ.id not in kitchen_order.pos_categ_ids.ids:
                    _logger.info(f"Category {categ.name} not in kitchen config")
                    return 'no category'
                
        if kitchen_order:
            if pos_order.order_status == 'ready':
                return False
            else:
                return True
        else:
            return True


class PosOrderLine(models.Model):
    """Inheriting the pos order line"""
    _inherit = "pos.order.line"

    order_status = fields.Selection(
        selection=[('draft', 'Draft'), ('waiting', 'Cooking'),
                   ('ready', 'Ready'), ('cancel', 'Cancel')], default='draft',
        help='The status of orderliness')
    order_ref = fields.Char(related='order_id.order_ref',
                            string='Order Reference',
                            help='Order reference of order')
    is_cooking = fields.Boolean(string="Cooking", default=False,
                                help='To identify the order is '
                                     'kitchen orders')
    customer_id = fields.Many2one('res.partner', string="Customer",
                                  related='order_id.partner_id',
                                  help='Id of the customer')

    def get_product_details(self, ids):
        """To get the product details"""
        lines = self.env['pos.order'].browse(ids)
        res = []
        for rec in lines:
            res.append({
                'product_id': rec.product_id.id,
                'name': rec.product_id.name,
                'qty': rec.qty
            })
        return res

    def order_progress_change(self):
        """Calling function from js to change the order_line status"""
        if self.order_status == 'ready':
            self.order_status = 'waiting'
        else:
            self.order_status = 'ready'