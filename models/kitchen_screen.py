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
from odoo import api, fields, models


class KitchenScreen(models.Model):
    """Kitchen Screen model for the cook"""
    _name = 'kitchen.screen'
    _description = 'Pos Kitchen Screen'
    _rec_name = 'sequence'
    _order = 'sequence, id'

    def _pos_shop_id(self):
        """Domain for the Pos Shop"""
        kitchen = self.search([])
        if kitchen:
            return [('module_pos_restaurant', '=', True),
                    ('id', 'not in', [rec.pos_config_id.id for rec in kitchen])]
        else:
            return [('module_pos_restaurant', '=', True)]

    sequence = fields.Char(readonly=True, default='New',
                           copy=False, tracking=True, help="Sequence of items")
    pos_config_id = fields.Many2one('pos.config', string='Allowed POS',
                                    domain=_pos_shop_id,
                                    help="Allowed POS for kitchen")
    pos_categ_ids = fields.Many2many('pos.category',
                                     string='Allowed POS Category',
                                     help="Allowed POS Category"
                                          "for the corresponding Pos")
    shop_number = fields.Integer(related='pos_config_id.id', string='Shop ID',
                                 help="ID of the POS")
    active = fields.Boolean(default=True, help="Set active to display this configuration")

    def kitchen_screen(self):
        """Redirect to corresponding kitchen screen for the cook"""
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'kitchen_custom_dashboard_tags',
            'name': f'Kitchen Screen: {self.pos_config_id.name}',
            'target': 'fullscreen',
            'context': {
                'default_shop_id': self.pos_config_id.id,
            },
        }
        
    def get_kitchen_categories(self):
        """Returns the configured categories for the kitchen screen"""
        self.ensure_one()
        if not self.pos_categ_ids:
            # If no categories configured, get all POS categories
            return self.env['pos.category'].search([]).ids
        return self.pos_categ_ids.ids

    @api.model_create_multi
    def create(self, vals_list):
        """Used to create sequence"""
        for vals in vals_list:
            if vals.get('sequence', 'New') == 'New':
                vals['sequence'] = self.env['ir.sequence'].next_by_code(
                    'kitchen.screen')
        result = super(KitchenScreen, self).create(vals_list)
        return result