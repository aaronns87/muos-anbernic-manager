// Every scheme setting the MustardOS frontend reads (common/display/theme.c, 2601.x) with its built-in default.
// [section, key, type, default, min, max]. Types: h colour (RRGGBB), i whole number, f decimal, s text.
// A null default depends on the screen size; see dynamicDefault.

export const FIELDS = [
  ["background", "BACKGROUND", "h", "C69200"],
  ["background", "BACKGROUND_ALPHA", "i", 255],
  ["background", "BACKGROUND_GRADIENT_COLOR", "h", "C69200"],
  ["background", "BACKGROUND_GRADIENT_START", "i", 0],
  ["background", "BACKGROUND_GRADIENT_STOP", "i", 200],
  ["background", "BACKGROUND_GRADIENT_DIRECTION", "i", 0],
  ["background", "BACKGROUND_GRADIENT_DITHER", "i", 0],
  ["background", "BACKGROUND_GRADIENT_BLUR", "i", 0],

  ["animation", "ANIMATION_DELAY", "i", 100, 10, null],
  ["animation", "ANIMATION_REPEAT", "i", 0],
  ["animation", "ANIMATION_FOREGROUND", "i", 0],
  ["animation", "ANIMATION_POSITION", "i", 4],
  ["animation", "ANIMATION_ALPHA", "i", 255, 0, 255],

  ["font", "FONT_LIST_SIZE", "i", 0, 0, null],
  ["font", "FONT_HEADER_SIZE", "i", 0, 0, null],
  ["font", "FONT_FOOTER_SIZE", "i", 0, 0, null],
  ["font", "FONT_PANEL_SIZE", "i", 0, 0, null],
  ["font", "FONT_HEADER_PAD_TOP", "i", 0],
  ["font", "FONT_HEADER_PAD_BOTTOM", "i", 0],
  ["font", "FONT_HEADER_ICON_PAD_TOP", "i", 0],
  ["font", "FONT_HEADER_ICON_PAD_BOTTOM", "i", 0],
  ["font", "FONT_FOOTER_PAD_TOP", "i", 0],
  ["font", "FONT_FOOTER_PAD_BOTTOM", "i", 0],
  ["font", "FONT_FOOTER_ICON_PAD_TOP", "i", 0],
  ["font", "FONT_FOOTER_ICON_PAD_BOTTOM", "i", 0],
  ["font", "FONT_MESSAGE_PAD_TOP", "i", 0],
  ["font", "FONT_MESSAGE_PAD_BOTTOM", "i", 0],
  ["font", "FONT_MESSAGE_ICON_PAD_TOP", "i", 0],
  ["font", "FONT_MESSAGE_ICON_PAD_BOTTOM", "i", 0],
  ["font", "FONT_LIST_PAD_TOP", "i", 0],
  ["font", "FONT_LIST_PAD_BOTTOM", "i", 0],
  ["font", "FONT_LIST_PAD_LEFT", "i", 32],
  ["font", "FONT_LIST_PAD_RIGHT", "i", 6],
  ["font", "FONT_LIST_ICON_PAD_TOP", "i", 0],
  ["font", "FONT_LIST_ICON_PAD_BOTTOM", "i", 0],

  ["status", "ALIGN", "i", 1],
  ["status", "PADDING_LEFT", "i", 0],
  ["status", "PADDING_RIGHT", "i", 0],

  ["battery", "BATTERY_NORMAL", "h", "FFFFFF"],
  ["battery", "BATTERY_ACTIVE", "h", "85F718"],
  ["battery", "BATTERY_LOW", "h", "D35C54"],
  ["battery", "BATTERY_NORMAL_ALPHA", "i", 255],
  ["battery", "BATTERY_ACTIVE_ALPHA", "i", 255],
  ["battery", "BATTERY_LOW_ALPHA", "i", 255],

  ["network", "NETWORK_NORMAL", "h", "282525"],
  ["network", "NETWORK_ACTIVE", "h", "F7E318"],
  ["network", "NETWORK_NORMAL_ALPHA", "i", 255],
  ["network", "NETWORK_ACTIVE_ALPHA", "i", 255],

  ["bluetooth", "BLUETOOTH_NORMAL", "h", "282525"],
  ["bluetooth", "BLUETOOTH_ACTIVE", "h", "F7E318"],
  ["bluetooth", "BLUETOOTH_NORMAL_ALPHA", "i", 255],
  ["bluetooth", "BLUETOOTH_ACTIVE_ALPHA", "i", 255],

  ["date", "DATETIME_TEXT", "h", "FFFFFF"],
  ["date", "DATETIME_ALPHA", "i", 255],
  ["date", "DATETIME_ALIGN", "i", 1],
  ["date", "PADDING_LEFT", "i", 0],
  ["date", "PADDING_RIGHT", "i", 0],

  ["footer", "FOOTER_HEIGHT", "i", 42],
  ["footer", "FOOTER_BACKGROUND", "h", "100808"],
  ["footer", "FOOTER_BACKGROUND_ALPHA", "i", 255],
  ["footer", "FOOTER_TEXT", "h", "FFFFFF"],
  ["footer", "FOOTER_TEXT_ALPHA", "i", 255],

  ["header", "HEADER_HEIGHT", "i", 42],
  ["header", "HEADER_BACKGROUND", "h", "100808"],
  ["header", "HEADER_BACKGROUND_ALPHA", "i", 255],
  ["header", "HEADER_TEXT", "h", "FFFFFF"],
  ["header", "HEADER_TEXT_ALPHA", "i", 255],
  ["header", "HEADER_TEXT_ALIGN", "i", 2],
  ["header", "PADDING_LEFT", "i", 0],
  ["header", "PADDING_RIGHT", "i", 0],

  ["help", "HELP_BACKGROUND", "h", "282525"],
  ["help", "HELP_BACKGROUND_ALPHA", "i", 255],
  ["help", "HELP_BORDER", "h", "100808"],
  ["help", "HELP_BORDER_ALPHA", "i", 255],
  ["help", "HELP_CONTENT", "h", "A5B2B5"],
  ["help", "HELP_TITLE", "h", "F7E318"],
  ["help", "HELP_RADIUS", "i", 3],

  ["dialogue", "DIALOGUE_BACKGROUND", "h", "282525"],
  ["dialogue", "DIALOGUE_BACKGROUND_ALPHA", "i", 255],
  ["dialogue", "DIALOGUE_BORDER", "h", "100808"],
  ["dialogue", "DIALOGUE_BORDER_ALPHA", "i", 255],
  ["dialogue", "DIALOGUE_TITLE", "h", "F7E318"],
  ["dialogue", "DIALOGUE_CONTENT", "h", "A5B2B5"],
  ["dialogue", "DIALOGUE_OPTION", "h", "282525"],
  ["dialogue", "DIALOGUE_DIM_ALPHA", "i", 128],
  ["dialogue", "DIALOGUE_SELECTION", "h", "F7E318"],
  ["dialogue", "DIALOGUE_SELECTION_ALPHA", "i", 255],
  ["dialogue", "DIALOGUE_RADIUS_MAIN", "i", 3],
  ["dialogue", "DIALOGUE_RADIUS_SELECTED", "i", 0],
  ["dialogue", "DIALOGUE_SHADOW_COLOUR", "h", "000000"],
  ["dialogue", "DIALOGUE_SHADOW_ALPHA", "i", 255, 0, 255],
  ["dialogue", "DIALOGUE_SHADOW_X_OFFSET", "i", 2],
  ["dialogue", "DIALOGUE_SHADOW_Y_OFFSET", "i", 2],
  ["dialogue", "DIALOGUE_SHADOW_COLOUR_FOCUS", "h", "222222"],
  ["dialogue", "DIALOGUE_SHADOW_ALPHA_FOCUS", "i", 96, 0, 255],
  ["dialogue", "DIALOGUE_SHADOW_X_OFFSET_FOCUS", "i", 2],
  ["dialogue", "DIALOGUE_SHADOW_Y_OFFSET_FOCUS", "i", 2],

  ["navigation", "ALIGNMENT", "i", 255],
  ["navigation", "SPACING", "i", 5],
  ["navigation", "NAV_LR_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_LR_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_LR_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_LR_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_LR_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_UD_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_UD_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_UD_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_UD_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_UD_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_A_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_A_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_A_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_A_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_A_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_B_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_B_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_B_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_B_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_B_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_C_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_C_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_C_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_C_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_C_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_X_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_X_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_X_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_X_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_X_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_Y_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_Y_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_Y_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_Y_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_Y_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_Z_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_Z_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_Z_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_Z_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_Z_TEXT_ALPHA", "i", 255],
  ["navigation", "NAV_MENU_GLYPH", "h", "F7E318"],
  ["navigation", "NAV_MENU_GLYPH_ALPHA", "i", 255],
  ["navigation", "NAV_MENU_GLYPH_RECOLOUR_ALPHA", "i", 255],
  ["navigation", "NAV_MENU_TEXT", "h", "FFFFFF"],
  ["navigation", "NAV_MENU_TEXT_ALPHA", "i", 255],

  ["grid", "NAVIGATION_TYPE", "i", 2],
  ["grid", "BACKGROUND", "h", "C69200"],
  ["grid", "BACKGROUND_ALPHA", "i", 0],
  ["grid", "ALIGNMENT", "i", 0],
  ["grid", "ALIGNMENT_X_OFFSET", "i", 0],
  ["grid", "ALIGNMENT_Y_OFFSET", "i", 0],
  ["grid", "LOCATION_X", "i", 0],
  ["grid", "LOCATION_Y", "i", 0],
  ["grid", "COLUMN_COUNT", "i", 0],
  ["grid", "COLUMN_PADDING", "i", 0],
  ["grid", "ROW_COUNT", "i", 0],
  ["grid", "ROW_PADDING", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_ALIGNMENT", "i", 5],
  ["grid", "CURRENT_ITEM_LABEL_WIDTH", "i", null],
  ["grid", "CURRENT_ITEM_LABEL_HEIGHT", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_OFFSET_X", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_OFFSET_Y", "i", null],
  ["grid", "CURRENT_ITEM_LABEL_RADIUS", "i", 10],
  ["grid", "CURRENT_ITEM_LABEL_BORDER_WIDTH", "i", 5],
  ["grid", "CURRENT_ITEM_LABEL_BORDER", "h", "F7E318"],
  ["grid", "CURRENT_ITEM_LABEL_BORDER_ALPHA", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND", "h", "F7E318"],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND_ALPHA", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND_GRADIENT_COLOR", "h", "F7E318"],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND_GRADIENT_START", "i", 255],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND_GRADIENT_STOP", "i", 255],
  ["grid", "CURRENT_ITEM_LABEL_BACKGROUND_GRADIENT_DIRECTION", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_SHADOW", "h", "000000"],
  ["grid", "CURRENT_ITEM_LABEL_SHADOW_WIDTH", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_SHADOW_X_OFFSET", "i", 10],
  ["grid", "CURRENT_ITEM_LABEL_SHADOW_Y_OFFSET", "i", 10],
  ["grid", "CURRENT_ITEM_LABEL_LABEL_LONG_MODE", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT", "h", "100808"],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_ALPHA", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_ALIGNMENT", "i", 2],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_LINE_SPACING", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_PADDING_BOTTOM", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_PADDING_LEFT", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_PADDING_RIGHT", "i", 0],
  ["grid", "CURRENT_ITEM_LABEL_TEXT_PADDING_TOP", "i", 0],
  ["grid", "ROW_HEIGHT", "i", 0],
  ["grid", "COLUMN_WIDTH", "i", 0],
  ["grid", "CELL_COLUMN_ALIGN", "i", 1],
  ["grid", "CELL_ROW_ALIGN", "i", 1],
  ["grid", "CELL_WIDTH", "i", 200],
  ["grid", "CELL_HEIGHT", "i", 200],
  ["grid", "CELL_RADIUS", "i", 10],
  ["grid", "CELL_BORDER_WIDTH", "i", 5],
  ["grid", "CELL_IMAGE_PADDING_TOP", "i", 5],
  ["grid", "CELL_TEXT_PADDING_BOTTOM", "i", 5],
  ["grid", "CELL_TEXT_PADDING_SIDE", "i", 5],
  ["grid", "CELL_TEXT_LINE_SPACING", "i", 0],
  ["grid", "CELL_SHADOW", "h", "000000"],
  ["grid", "CELL_SHADOW_WIDTH", "i", 0],
  ["grid", "CELL_SHADOW_X_OFFSET", "i", 10],
  ["grid", "CELL_SHADOW_Y_OFFSET", "i", 10],
  ["grid", "CELL_DEFAULT_BACKGROUND", "h", "C69200"],
  ["grid", "CELL_DEFAULT_BACKGROUND_ALPHA", "i", 255],
  ["grid", "CELL_DEFAULT_BACKGROUND_GRADIENT_COLOR", "h", "C69200"],
  ["grid", "CELL_DEFAULT_BACKGROUND_GRADIENT_START", "i", 0],
  ["grid", "CELL_DEFAULT_BACKGROUND_GRADIENT_STOP", "i", 200],
  ["grid", "CELL_DEFAULT_BACKGROUND_GRADIENT_DIRECTION", "i", 0],
  ["grid", "CELL_DEFAULT_BORDER", "h", "C69200"],
  ["grid", "CELL_DEFAULT_BORDER_ALPHA", "i", 255],
  ["grid", "CELL_DEFAULT_IMAGE_ALPHA", "i", 255],
  ["grid", "CELL_DEFAULT_IMAGE_RECOLOUR", "h", "FFFFFF"],
  ["grid", "CELL_DEFAULT_IMAGE_RECOLOUR_ALPHA", "i", 0],
  ["grid", "CELL_DEFAULT_TEXT", "h", "FFFFFF"],
  ["grid", "CELL_DEFAULT_TEXT_ALPHA", "i", 255],
  ["grid", "CELL_FOCUS_BACKGROUND", "h", "F7E318"],
  ["grid", "CELL_FOCUS_BACKGROUND_ALPHA", "i", 255],
  ["grid", "CELL_FOCUS_BACKGROUND_GRADIENT_COLOR", "h", "F7E318"],
  ["grid", "CELL_FOCUS_BACKGROUND_GRADIENT_START", "i", 0],
  ["grid", "CELL_FOCUS_BACKGROUND_GRADIENT_STOP", "i", 200],
  ["grid", "CELL_FOCUS_BACKGROUND_GRADIENT_DIRECTION", "i", 0],
  ["grid", "CELL_FOCUS_BORDER", "h", "F7E318"],
  ["grid", "CELL_FOCUS_BORDER_ALPHA", "i", 255],
  ["grid", "CELL_FOCUS_IMAGE_ALPHA", "i", 255],
  ["grid", "CELL_FOCUS_IMAGE_RECOLOUR", "h", "FFFFFF"],
  ["grid", "CELL_FOCUS_IMAGE_RECOLOUR_ALPHA", "i", 0],
  ["grid", "CELL_FOCUS_TEXT", "h", "100808"],
  ["grid", "CELL_FOCUS_TEXT_ALPHA", "i", 255],

  ["list", "LIST_DEFAULT_RADIUS", "i", 0],
  ["list", "LIST_DEFAULT_BACKGROUND", "h", "C69200"],
  ["list", "LIST_DEFAULT_BACKGROUND_ALPHA", "i", 255],
  ["list", "LIST_DEFAULT_GRADIENT_START", "i", 0],
  ["list", "LIST_DEFAULT_GRADIENT_STOP", "i", 200],
  ["list", "LIST_DEFAULT_GRADIENT_DIRECTION", "i", 0],
  ["list", "LIST_DEFAULT_BORDER_WIDTH", "i", 5],
  ["list", "LIST_DEFAULT_BORDER_SIDE", "i", 4],
  ["list", "LIST_DEFAULT_INDICATOR", "h", "A5B2B5"],
  ["list", "LIST_DEFAULT_INDICATOR_ALPHA", "i", 255],
  ["list", "LIST_DEFAULT_TEXT", "h", "FFFFFF"],
  ["list", "LIST_DEFAULT_TEXT_ALPHA", "i", 255],
  ["list", "LIST_DEFAULT_GLYPH_PAD_LEFT", "i", 5],
  ["list", "LIST_DEFAULT_GLYPH_PAD_RIGHT", "i", 6],
  ["list", "LIST_DEFAULT_GLYPH_ALPHA", "i", 255],
  ["list", "LIST_DEFAULT_GLYPH_RECOLOUR", "h", "FFFFFF"],
  ["list", "LIST_DEFAULT_GLYPH_RECOLOUR_ALPHA", "i", 0],
  ["list", "LIST_DEFAULT_LABEL_LONG_MODE", "i", 3],
  ["list", "LIST_DEFAULT_SHADOW_COLOUR", "h", "000000"],
  ["list", "LIST_DEFAULT_SHADOW_ALPHA", "i", 255, 0, 255],
  ["list", "LIST_DEFAULT_SHADOW_X_OFFSET", "i", 2],
  ["list", "LIST_DEFAULT_SHADOW_Y_OFFSET", "i", 2],
  ["list", "LIST_DISABLED_TEXT", "h", "808080"],
  ["list", "LIST_DISABLED_TEXT_ALPHA", "i", 255],
  ["list", "LIST_FOCUS_BACKGROUND", "h", "F7E318"],
  ["list", "LIST_FOCUS_BACKGROUND_ALPHA", "i", 255],
  ["list", "LIST_FOCUS_GRADIENT_START", "i", 0],
  ["list", "LIST_FOCUS_GRADIENT_STOP", "i", 200],
  ["list", "LIST_FOCUS_GRADIENT_DIRECTION", "i", 0],
  ["list", "LIST_FOCUS_BORDER_WIDTH", "i", 5],
  ["list", "LIST_FOCUS_BORDER_SIDE", "i", 4],
  ["list", "LIST_FOCUS_INDICATOR", "h", "F7E318"],
  ["list", "LIST_FOCUS_INDICATOR_ALPHA", "i", 255],
  ["list", "LIST_FOCUS_TEXT", "h", "100808"],
  ["list", "LIST_FOCUS_TEXT_ALPHA", "i", 255],
  ["list", "LIST_FOCUS_GLYPH_ALPHA", "i", 255],
  ["list", "LIST_FOCUS_GLYPH_RECOLOUR", "h", "100808"],
  ["list", "LIST_FOCUS_GLYPH_RECOLOUR_ALPHA", "i", 0],
  ["list", "LIST_FOCUS_SHADOW_COLOUR", "h", "222222"],
  ["list", "LIST_FOCUS_SHADOW_ALPHA", "i", 96, 0, 255],
  ["list", "LIST_FOCUS_SHADOW_X_OFFSET", "i", 2],
  ["list", "LIST_FOCUS_SHADOW_Y_OFFSET", "i", 2],

  ["image_list", "IMAGE_LIST_ALPHA", "i", 255],
  ["image_list", "IMAGE_LIST_RADIUS", "i", 3],
  ["image_list", "IMAGE_LIST_RECOLOUR", "h", "F7E318"],
  ["image_list", "IMAGE_LIST_RECOLOUR_ALPHA", "i", 255],
  ["image_list", "IMAGE_LIST_PAD_TOP", "i", 0],
  ["image_list", "IMAGE_LIST_PAD_BOTTOM", "i", 0],
  ["image_list", "IMAGE_LIST_PAD_LEFT", "i", 0],
  ["image_list", "IMAGE_LIST_PAD_RIGHT", "i", 0],
  ["image_list", "IMAGE_PREVIEW_ALPHA", "i", 255],
  ["image_list", "IMAGE_PREVIEW_RADIUS", "i", 3],
  ["image_list", "IMAGE_PREVIEW_RECOLOUR", "h", "F7E318"],
  ["image_list", "IMAGE_PREVIEW_RECOLOUR_ALPHA", "i", 255],

  ["charging", "CHARGER_BACKGROUND", "h", "282525"],
  ["charging", "CHARGER_BACKGROUND_ALPHA", "i", 255],
  ["charging", "CHARGER_TEXT", "h", "FFFFFF"],
  ["charging", "CHARGER_TEXT_ALPHA", "i", 255],
  ["charging", "CHARGER_Y_POS", "i", 0],

  ["verbose", "VERBOSE_BOOT_BACKGROUND", "h", "000000"],
  ["verbose", "VERBOSE_BOOT_BACKGROUND_ALPHA", "i", 255],
  ["verbose", "VERBOSE_BOOT_TEXT", "h", "FFFFFF"],
  ["verbose", "VERBOSE_BOOT_TEXT_ALPHA", "i", 255],
  ["verbose", "VERBOSE_BOOT_Y_POS", "i", 0],

  ["keyboard", "OSK_BACKGROUND", "h", "100808"],
  ["keyboard", "OSK_BACKGROUND_ALPHA", "i", 255],
  ["keyboard", "OSK_BORDER", "h", "100808"],
  ["keyboard", "OSK_BORDER_ALPHA", "i", 255],
  ["keyboard", "OSK_RADIUS", "i", 3],
  ["keyboard", "OSK_TEXT", "h", "FFFFFF"],
  ["keyboard", "OSK_TEXT_ALPHA", "i", 255],
  ["keyboard", "OSK_TEXT_FOCUS", "h", "100808"],
  ["keyboard", "OSK_TEXT_FOCUS_ALPHA", "i", 255],
  ["keyboard", "OSK_ITEM_BACKGROUND", "h", "282525"],
  ["keyboard", "OSK_ITEM_BACKGROUND_ALPHA", "i", 255],
  ["keyboard", "OSK_ITEM_BACKGROUND_FOCUS", "h", "F7E318"],
  ["keyboard", "OSK_ITEM_BACKGROUND_FOCUS_ALPHA", "i", 255],
  ["keyboard", "OSK_ITEM_BORDER", "h", "282525"],
  ["keyboard", "OSK_ITEM_BORDER_ALPHA", "i", 255],
  ["keyboard", "OSK_ITEM_BORDER_FOCUS", "h", "F7E318"],
  ["keyboard", "OSK_ITEM_BORDER_FOCUS_ALPHA", "i", 255],
  ["keyboard", "OSK_ITEM_RADIUS", "i", 3],
  ["keyboard", "OSK_ITEM_SHADOW_COLOUR", "h", "000000"],
  ["keyboard", "OSK_ITEM_SHADOW_ALPHA", "i", 255, 0, 255],
  ["keyboard", "OSK_ITEM_SHADOW_X_OFFSET", "i", 2],
  ["keyboard", "OSK_ITEM_SHADOW_Y_OFFSET", "i", 2],
  ["keyboard", "OSK_ITEM_SHADOW_COLOUR_FOCUS", "h", "222222"],
  ["keyboard", "OSK_ITEM_SHADOW_ALPHA_FOCUS", "i", 96, 0, 255],
  ["keyboard", "OSK_ITEM_SHADOW_X_OFFSET_FOCUS", "i", 2],
  ["keyboard", "OSK_ITEM_SHADOW_Y_OFFSET_FOCUS", "i", 2],

  ["notification", "MSG_BACKGROUND", "h", "100808"],
  ["notification", "MSG_BACKGROUND_ALPHA", "i", 255],
  ["notification", "MSG_BORDER", "h", "100808"],
  ["notification", "MSG_BORDER_ALPHA", "i", 255],
  ["notification", "MSG_RADIUS", "i", 3],
  ["notification", "MSG_TEXT", "h", "FFFFFF"],
  ["notification", "MSG_TEXT_ALPHA", "i", 255],
  ["notification", "MSG_LEVEL_SUCCESS", "h", "4D9E4D"],
  ["notification", "MSG_LEVEL_WARNING", "h", "D9A33A"],
  ["notification", "MSG_LEVEL_ERROR", "h", "C24B4B"],

  ["bar", "BAR_WIDTH", "i", null],
  ["bar", "BAR_HEIGHT", "i", 42],
  ["bar", "BAR_BACKGROUND", "h", "100808"],
  ["bar", "BAR_BACKGROUND_ALPHA", "i", 255],
  ["bar", "BAR_BORDER", "h", "100808"],
  ["bar", "BAR_BORDER_ALPHA", "i", 255],
  ["bar", "BAR_RADIUS", "i", 3],
  ["bar", "BAR_PROGRESS_WIDTH", "i", null],
  ["bar", "BAR_PROGRESS_HEIGHT", "i", 16],
  ["bar", "BAR_PROGRESS_BACKGROUND", "h", "7E730C"],
  ["bar", "BAR_PROGRESS_BACKGROUND_ALPHA", "i", 255],
  ["bar", "BAR_PROGRESS_ACTIVE_BACKGROUND", "h", "F7E318"],
  ["bar", "BAR_PROGRESS_ACTIVE_BACKGROUND_ALPHA", "i", 255],
  ["bar", "BAR_PROGRESS_RADIUS", "i", 3],
  ["bar", "BAR_ICON", "h", "F7E318"],
  ["bar", "BAR_ICON_ALPHA", "i", 255],
  ["bar", "BAR_Y_POS", "i", null],

  ["roll", "ROLL_TEXT", "h", "7E730C"],
  ["roll", "ROLL_TEXT_ALPHA", "i", 255],
  ["roll", "ROLL_BACKGROUND", "h", "100808"],
  ["roll", "ROLL_BACKGROUND_ALPHA", "i", 255],
  ["roll", "ROLL_RADIUS", "i", 3],
  ["roll", "ROLL_SELECT_TEXT", "h", "F7E318"],
  ["roll", "ROLL_SELECT_TEXT_ALPHA", "i", 255],
  ["roll", "ROLL_SELECT_BACKGROUND", "h", "7E730C"],
  ["roll", "ROLL_SELECT_BACKGROUND_ALPHA", "i", 255],
  ["roll", "ROLL_SELECT_RADIUS", "i", 3],
  ["roll", "ROLL_BORDER_COLOUR", "h", "100808"],
  ["roll", "ROLL_BORDER_ALPHA", "i", 255],
  ["roll", "ROLL_BORDER_RADIUS", "i", 255],

  ["counter", "COUNTER_ALIGNMENT", "i", 0],
  ["counter", "COUNTER_PADDING_AROUND", "i", 5],
  ["counter", "COUNTER_PADDING_SIDE", "i", 15],
  ["counter", "COUNTER_PADDING_TOP", "i", 0],
  ["counter", "COUNTER_BORDER_COLOUR", "h", "100808"],
  ["counter", "COUNTER_BORDER_ALPHA", "i", 0],
  ["counter", "COUNTER_BORDER_WIDTH", "i", 2],
  ["counter", "COUNTER_RADIUS", "i", 0],
  ["counter", "COUNTER_BACKGROUND", "h", "100808"],
  ["counter", "COUNTER_BACKGROUND_ALPHA", "i", 0],
  ["counter", "COUNTER_TEXT", "h", "FFFFFF"],
  ["counter", "COUNTER_TEXT_ALPHA", "i", 0],
  ["counter", "COUNTER_TEXT_FADE_TIME", "i", 0],
  ["counter", "COUNTER_TEXT_SEPARATOR", "s", " / "],

  ["misc", "STATIC_ALIGNMENT", "i", 255],
  ["misc", "CONTENT_ITEM_COUNT", "i", 11],
  ["misc", "CONTENT_ITEM_HEIGHT", "i", 0],
  ["misc", "CONTENT_SIZE_TO_CONTENT", "i", 0],
  ["misc", "CONTENT_ALIGNMENT", "i", 0],
  ["misc", "CONTENT_PADDING_LEFT", "i", 0],
  ["misc", "CONTENT_PADDING_TOP", "i", 0],
  ["misc", "CONTENT_HEIGHT", "i", null],
  ["misc", "CONTENT_WIDTH", "i", null],
  ["misc", "ANIMATED_BACKGROUND", "i", 0],
  ["misc", "RANDOM_BACKGROUND", "i", 0],
  ["misc", "IMAGE_OVERLAY", "i", 0],
  ["misc", "NAVIGATION_TYPE", "i", 0],
  ["misc", "ANTIALIASING", "i", 1],
  ["misc", "LABEL_WIDTH", "i", 57],
  ["misc", "PEEK_OPACITY", "i", 48],

  ["glyph", "LIST", "i", 0],
  ["glyph", "FOOTER", "i", 0],
  ["glyph", "HEADER", "i", 0],
  ["glyph", "GRID", "i", 0],

  ["terminal", "FONT_SIZE", "s", "16"],
  ["terminal", "FOREGROUND", "h", "FFFFFF"],
  ["terminal", "BACKGROUND", "h", "000000"],

  ["sdl", "TEXTURE_BLEND_MODE", "i", 1],
  ["sdl", "DRAW_BLEND_MODE", "i", 0],
  ["sdl", "RENDER_OFFSET_X", "f", 0],
  ["sdl", "RENDER_OFFSET_Y", "f", 0],
  ["sdl", "SOLID_R", "i", 0],
  ["sdl", "SOLID_G", "i", 0],
  ["sdl", "SOLID_B", "i", 0],
];

/** Defaults that depend on the screen: fixed by the frontend before any scheme is read. */
export function dynamicDefault(key, w, h) {
  switch (key) {
    case "CURRENT_ITEM_LABEL_WIDTH": return Math.trunc(w * 0.8);
    case "CURRENT_ITEM_LABEL_OFFSET_Y": return -84;
    case "BAR_WIDTH": return w - 25;
    case "BAR_PROGRESS_WIDTH": return w - 90;
    case "BAR_Y_POS": return h - 96;
    case "CONTENT_HEIGHT": return h - 88;
    case "CONTENT_WIDTH": return w;
  }
  return 0;
}

export const RESOLUTIONS = ["640x480", "720x480", "720x576", "720x720", "1024x768", "1280x720", "1920x1080"];

/** version.txt values the theme picker accepts: the theme's version must start a supported release name. */
export const VERSIONS = [
  ["2601.0", "2601.0 Jacaranda and newer"], ["2601.1", "2601.1 Funky Jacaranda only"],
  ["2508.0", "2508 Goose and newer"],
];

// ---------------------------------------------------------------- how a setting is edited

const DIRECTION = [[0, "None"], [1, "Top to bottom"], [2, "Left to right"]];
const ONOFF = [[0, "Off"], [1, "On"]];
const ALIGN4 = [[0, "Auto"], [1, "Left"], [2, "Centre"], [3, "Right"]];
const LEFT_CENTRE_RIGHT = [[0, "Left"], [1, "Centre"], [2, "Right"]];
const PLACE = [[1, "Top left"], [2, "Top centre"], [3, "Top right"], [7, "Left middle"], [9, "Centre"], [8, "Right middle"], [4, "Bottom left"], [5, "Bottom centre"], [6, "Bottom right"]];
const LONG = [[0, "Wrap onto more lines"], [1, "Cut off with dots"], [2, "Scroll back and forth"], [3, "Scroll round"], [4, "Cut off"]];
const BLEND = [[0, "None"], [1, "Blend"], [2, "Add"], [4, "Modulate"], [8, "Multiply"]];

/** Choices for settings that take one of a few numbers; null when the setting is a free value. */
export function choicesFor(section, key) {
  if (/_GRADIENT_DIRECTION$/.test(key)) return DIRECTION;
  if (/_LABEL_LONG_MODE$/.test(key)) return LONG;
  if (/^(BACKGROUND_GRADIENT_DITHER|CONTENT_SIZE_TO_CONTENT|RANDOM_BACKGROUND|ANIMATED_BACKGROUND|IMAGE_OVERLAY|ANTIALIASING)$/.test(key)) return ONOFF;
  if (key === "DATETIME_ALIGN" || key === "HEADER_TEXT_ALIGN") return ALIGN4;
  if (key === "CURRENT_ITEM_LABEL_TEXT_ALIGNMENT") return ALIGN4;
  if (key === "CURRENT_ITEM_LABEL_ALIGNMENT") return PLACE;
  if (key === "CONTENT_ALIGNMENT" || key === "COUNTER_ALIGNMENT") return LEFT_CENTRE_RIGHT;
  if (key === "CELL_COLUMN_ALIGN") return LEFT_CENTRE_RIGHT;
  if (key === "CELL_ROW_ALIGN") return [[0, "Top"], [1, "Centre"], [2, "Bottom"]];
  if (key === "TEXTURE_BLEND_MODE" || key === "DRAW_BLEND_MODE") return BLEND;
  if (section === "status" && key === "ALIGN") return [[0, "Left"], [1, "Right"], [2, "Centre"], [3, "Spread across the header"], [4, "Spread, space around"], [5, "First left, last right"]];
  if (section === "navigation" && key === "ALIGNMENT") return [[255, "Left"], [1, "Centre"], [2, "Right"], [3, "Spread, space around"], [4, "Spread to the edges"], [5, "Spread evenly"]];
  if (section === "grid" && key === "ALIGNMENT") return [[0, "At location X and Y"], ...PLACE];
  if (section === "grid" && key === "NAVIGATION_TYPE") return [[2, "Arrows; left and right go on to the next row"], [4, "Arrows; left and right wrap round the row"]];
  if (section === "misc" && key === "NAVIGATION_TYPE") return [[0, "Up and down"], [1, "Left and right"], [2, "Two rows of 4"], [3, "Rows of 3 and 5"], [4, "Two rows of 4, wrapping"], [5, "Rows of 3 and 5, wrapping"]];
  if (key === "STATIC_ALIGNMENT") return [[255, "Where the screen puts it"], [0, "Bottom right, above the footer"], [1, "Middle right"], [2, "Top right, below the header"], [3, "Full screen, behind the bars"], [4, "Full screen, in front"]];
  return null;
}

export const SIDES = [[2, "Top"], [1, "Bottom"], [4, "Left"], [8, "Right"]];
export const isSides = (key) => /_BORDER_SIDE$/.test(key);
export const isAlpha = (key) => /_ALPHA(_FOCUS)?$/.test(key) || key === "PEEK_OPACITY";

/** The opacity setting that belongs to a colour, shown as one control with it. */
export function alphaOf(key) {
  if (/_COLOUR(_FOCUS)?$/.test(key)) return key.replace(/_COLOUR(_FOCUS)?$/, "_ALPHA$1");
  if (key === "DATETIME_TEXT") return "DATETIME_ALPHA";
  return `${key}_ALPHA`;
}

/** Explanations for settings whose name does not say enough. */
export const HINTS = {
  BACKGROUND_GRADIENT_START: "Where the second colour starts to blend in, 0 to 255 along the direction.",
  BACKGROUND_GRADIENT_STOP: "Where the blend is complete, 0 to 255.",
  BACKGROUND_GRADIENT_BLUR: "0 is off; higher numbers blur more.",
  LIST_DEFAULT_GRADIENT_START: "Items blend from their colour into the screen background. 255 keeps one solid colour.",
  LIST_FOCUS_GRADIENT_START: "The selected item blends into the screen background. 255 keeps one solid colour.",
  LIST_DEFAULT_RADIUS: "Corner roundness of every list item; half the item height makes a pill.",
  LIST_DEFAULT_GLYPH_PAD_LEFT: "Space left of the item's icon.",
  LIST_DEFAULT_GLYPH_PAD_RIGHT: "Space between the icon and the text.",
  FONT_LIST_PAD_LEFT: "Where the text starts. With icons on this is worked out from the icon size and padding.",
  FONT_LIST_PAD_TOP: "Moves the text down. Use this or bottom padding, not both.",
  FONT_LIST_PAD_BOTTOM: "Moves the text up.",
  CONTENT_ITEM_COUNT: "How many items fit on one page; their height follows from the content height.",
  CONTENT_ITEM_HEIGHT: "A fixed item height instead of an item count. 0 uses the count.",
  CONTENT_HEIGHT: "Height of the list area. The default is the screen height less 88.",
  CONTENT_WIDTH: "Width of the list; make room on the right for box art in Explore.",
  CONTENT_PADDING_TOP: "Moves the list down from just below the header; negative values go up.",
  CONTENT_PADDING_LEFT: "Moves the list right; negative values go left.",
  CONTENT_SIZE_TO_CONTENT: "Items are only as wide as their text, up to the content width.",
  STATIC_ALIGNMENT: "Where a static image from image/static sits and whether it covers the bars.",
  RANDOM_BACKGROUND: "Picks one of screen.0.png, screen.1.png and so on at random.",
  IMAGE_OVERLAY: "Lays image/overlay.png over every screen when the handheld's overlay setting asks for the theme's.",
  NAVIGATION_TYPE: "How the arrows move through a menu drawn as pictures instead of a list.",
  LABEL_WIDTH: "Share of the width, in percent, that option names get before their values.",
  PEEK_OPACITY: "How visible the items half off the edge of a grid are.",
  COLUMN_COUNT: "Columns in a grid. A grid shows when both columns and rows are more than 0.",
  ROW_COUNT: "Rows visible at once.",
  COLUMN_WIDTH: "0 shares the content width between the columns.",
  ROW_HEIGHT: "0 shares the content height between the rows.",
  CELL_IMAGE_PADDING_TOP: "Space above the cell's picture. With the label hidden the picture is centred.",
  CURRENT_ITEM_LABEL_WIDTH: "0 fits the text.",
  CURRENT_ITEM_LABEL_HEIGHT: "0 fits the text.",
  CURRENT_ITEM_LABEL_OFFSET_Y: "Measured from where the label is placed; negative moves it up.",
  ANIMATION_DELAY: "Milliseconds per frame of an animated background.",
  ANIMATION_POSITION: "Where the animation sits on the screen.",
  COUNTER_TEXT_FADE_TIME: "Fades the counter out after this long without input. 0 keeps it.",
  COUNTER_TEXT_SEPARATOR: "Text between the position and the total, as in 3 / 40.",
  CHARGER_Y_POS: "Moves the charging text from the middle; negative is up.",
  VERBOSE_BOOT_Y_POS: "Height of the start-up messages from the top.",
  BAR_Y_POS: "Height of the volume and brightness bar from the top.",
  FONT_LIST_SIZE: "0 uses the size the font was made in.",
  FONT_HEADER_SIZE: "0 uses the size the font was made in.",
  FONT_FOOTER_SIZE: "0 uses the size the font was made in.",
  FONT_PANEL_SIZE: "0 uses the size the font was made in.",
  ALIGN: "How the battery, network and Bluetooth icons line up.",
  ALIGNMENT: "How the footer's button hints line up.",
  SPACING: "Space between the footer's button hints.",
  NAV_A_GLYPH: "The A button picture in the footer is tinted with this colour.",
  LIST: "Icon size in lists in pixels. 0 picks one from the item height.",
  HEADER: "Icon size in the header in pixels. 0 is automatic.",
  FOOTER: "Icon size in the footer in pixels. 0 is automatic.",
  GRID: "Icon size in grids in pixels. 0 is automatic.",
  TEXTURE_BLEND_MODE: "For apps drawn with SDL, such as the terminal.",
};

// ---------------------------------------------------------------- labels

const STRIP = [
  "CURRENT_ITEM_LABEL_", "LIST_DEFAULT_", "LIST_FOCUS_", "LIST_DISABLED_", "CELL_DEFAULT_", "CELL_FOCUS_", "CELL_",
  "IMAGE_LIST_", "IMAGE_PREVIEW_", "OSK_ITEM_", "OSK_", "MSG_", "BAR_PROGRESS_", "BAR_", "ROLL_SELECT_", "ROLL_", "COUNTER_",
  "CHARGER_", "VERBOSE_BOOT_", "DIALOGUE_", "HELP_", "HEADER_", "FOOTER_", "DATETIME_", "BATTERY_", "NETWORK_", "BLUETOOTH_",
  "FONT_HEADER_", "FONT_FOOTER_", "FONT_LIST_", "FONT_MESSAGE_", "FONT_", "CONTENT_", "ANIMATION_", "RENDER_", "SOLID_",
];
const WORDS = {
  RECOLOUR: "tint", ALPHA: "opacity", PAD: "padding", POS: "position", GLYPH: "icon", COLOR: "colour", INDICATOR: "border",
  RADIUS: "corner radius", BG: "background", MAIN: "window", ICON: "icon", LR: "left/right", UD: "up/down", OSK: "keyboard",
};
const LABELS = {
  "background.BACKGROUND": "Colour", "background.BACKGROUND_GRADIENT_COLOR": "Gradient colour",
  "grid.BACKGROUND": "Grid background",
  "status.ALIGN": "Icon alignment", "navigation.ALIGNMENT": "Alignment",
  "list.LIST_DEFAULT_INDICATOR": "Border", "list.LIST_FOCUS_INDICATOR": "Border",
  "help.HELP_CONTENT": "Text", "dialogue.DIALOGUE_CONTENT": "Text", "dialogue.DIALOGUE_OPTION": "Option text",
  "dialogue.DIALOGUE_DIM_ALPHA": "Dim the screen behind",
  "notification.MSG_LEVEL_SUCCESS": "Success colour", "notification.MSG_LEVEL_WARNING": "Warning colour", "notification.MSG_LEVEL_ERROR": "Error colour",
  "glyph.LIST": "List icon size", "glyph.HEADER": "Header icon size", "glyph.FOOTER": "Footer icon size", "glyph.GRID": "Grid icon size",
  "misc.NAVIGATION_TYPE": "Menu navigation", "grid.NAVIGATION_TYPE": "Grid navigation", "misc.LABEL_WIDTH": "Option name width",
  "terminal.FONT_SIZE": "Font size", "terminal.FOREGROUND": "Text", "terminal.BACKGROUND": "Background",
};

/** A short readable name for a setting; the group heading supplies the context. */
export function labelFor(section, key) {
  const fixed = LABELS[`${section}.${key}`];
  if (fixed) return fixed;
  let k = key.replace(/^NAV_[A-Z]+_/, "");
  for (const p of STRIP) if (k.startsWith(p) && k.length > p.length) { k = k.slice(p.length); break; }
  if (k === "GLYPH") k = "ICON_COLOUR";
  if (k === "GLYPH_RECOLOUR_ALPHA") k = "ICON_TINT_STRENGTH";
  if (/^(IMAGE_)?RECOLOUR_ALPHA$/.test(k)) k = k.replace("RECOLOUR_ALPHA", "TINT_STRENGTH");
  const selected = /_FOCUS$/.test(k) && k !== "BACKGROUND_FOCUS";
  if (selected) k = k.replace(/_FOCUS$/, "");
  if (k === "BACKGROUND_FOCUS") k = "SELECTED_BACKGROUND";
  const words = k.split("_").map((w) => WORDS[w] ?? w.toLowerCase());
  const text = words.join(" ").replace(/\bx\b/, "X").replace(/\by\b/, "Y").replace(/\br g b\b/, "RGB");
  return text.charAt(0).toUpperCase() + text.slice(1) + (selected ? " when selected" : "");
}

// ---------------------------------------------------------------- groups in the editor

const BUTTONS = [["A", "A button"], ["B", "B button"], ["X", "X button"], ["Y", "Y button"], ["C", "C button"], ["Z", "Z button"], ["MENU", "Menu button"], ["LR", "Left and right"], ["UD", "Up and down"]];

/** The editor's sections: [id, label, icon, preview screen, parts]; a part is [section, key pattern, heading]. */
export const GROUPS = [
  ["background", "Background", "image", "muxlaunch", [["background", /./, "Colour and gradient"]]],
  ["header", "Header", "layers", "muxlaunch", [
    ["header", /./, "Bar and title"], ["date", /./, "Clock"], ["status", /./, "Status icons"],
    ["battery", /./, "Battery"], ["network", /./, "Wi-Fi"], ["bluetooth", /./, "Bluetooth"], ["font", /^FONT_HEADER_(?!SIZE)/, "Text position"],
  ]],
  ["list", "List", "list", "muxconfig", [
    ["list", /^LIST_DEFAULT_(?!SHADOW)|^LIST_DISABLED_/, "Items"], ["list", /^LIST_FOCUS_(?!SHADOW)/, "Selected item"],
    ["list", /^LIST_DEFAULT_SHADOW/, "Text shadow"], ["list", /^LIST_FOCUS_SHADOW/, "Selected text shadow"],
    ["font", /^FONT_LIST_(?!SIZE)/, "Text position"], ["counter", /./, "Item counter"],
  ]],
  ["layout", "Layout", "sliders", "muxplore", [
    ["misc", /^CONTENT_|^LABEL_WIDTH$/, "Content area"], ["misc", /^NAVIGATION_TYPE$/, "Picture menus"],
  ]],
  ["footer", "Footer", "handheld", "muxlaunch", [
    ["footer", /./, "Bar"], ["navigation", /^(ALIGNMENT|SPACING)$/, "Button hints"],
    ...BUTTONS.map(([b, label]) => ["navigation", new RegExp(`^NAV_${b}_`), label]), ["font", /^FONT_FOOTER_(?!SIZE)/, "Text position"],
  ]],
  ["grid", "Grid", "grid", "muxlaunch", [
    ["grid", /^(NAVIGATION_TYPE|BACKGROUND(_ALPHA)?|ALIGNMENT.*|LOCATION_.|COLUMN_.*|ROW_.*)$/, "Layout"],
    ["grid", /^CELL_(WIDTH|HEIGHT|RADIUS|BORDER_WIDTH|COLUMN_ALIGN|ROW_ALIGN|IMAGE_PADDING_TOP|TEXT_.*|SHADOW.*)$/, "Cells"],
    ["grid", /^CELL_DEFAULT_/, "Cell"], ["grid", /^CELL_FOCUS_/, "Selected cell"],
    ["grid", /^CURRENT_ITEM_LABEL_/, "Name of the selected item"], ["misc", /^PEEK_OPACITY$/, "Edges"],
  ]],
  ["artwork", "Artwork", "star", "muxplore", [
    ["image_list", /^IMAGE_LIST_/, "Box art"], ["image_list", /^IMAGE_PREVIEW_/, "Preview picture"],
    ["misc", /^(STATIC_ALIGNMENT|IMAGE_OVERLAY|RANDOM_BACKGROUND|ANIMATED_BACKGROUND)$/, "Wallpaper and static pictures"],
    ["animation", /./, "Animated background"],
  ]],
  ["popups", "Pop-ups", "info", "popups", [
    ["help", /./, "Info window"], ["notification", /./, "Messages"], ["dialogue", /^DIALOGUE_(?!SHADOW)/, "Dialogues"],
    ["dialogue", /^DIALOGUE_SHADOW/, "Dialogue shadows"], ["font", /^FONT_MESSAGE_/, "Message text position"],
  ]],
  ["keyboard", "Keyboard", "hash", "keyboard", [
    ["keyboard", /^OSK_(?!ITEM)/, "Window"], ["keyboard", /^OSK_ITEM_(?!SHADOW)/, "Keys"], ["keyboard", /^OSK_ITEM_SHADOW/, "Key shadows"],
  ]],
  ["bar", "Volume bar", "gauge", "popups", [["bar", /^BAR_(?!PROGRESS)/, "Window"], ["bar", /^BAR_PROGRESS_/, "Progress"]]],
  ["roll", "Passcode", "lock", "passcode", [["roll", /./, "Passcode wheel"]]],
  ["boot", "Charging and start-up", "power", "muxcharge", [["charging", /./, "Charging screen"], ["verbose", /./, "Start-up messages"]]],
  ["advanced", "Advanced", "wrench", "muxconfig", [
    ["font", /_SIZE$/, "Font sizes"], ["glyph", /./, "Icon sizes"], ["misc", /^ANTIALIASING$/, "Text"],
    ["terminal", /./, "Terminal"], ["sdl", /./, "SDL apps"],
  ]],
];

/** Colours set together by Quick style: [id, label, hint, [section, key] list]. */
export const QUICK = [
  ["bg", "Background", "The screen behind everything", [
    ["background", "BACKGROUND"], ["background", "BACKGROUND_GRADIENT_COLOR"], ["grid", "CELL_DEFAULT_BACKGROUND"], ["grid", "CELL_DEFAULT_BACKGROUND_GRADIENT_COLOR"],
    ["keyboard", "OSK_ITEM_BACKGROUND"], ["roll", "ROLL_BACKGROUND"], ["list", "LIST_DEFAULT_BACKGROUND"], ["grid", "CELL_DEFAULT_BORDER"],
  ]],
  ["bar", "Bars and windows", "Header, footer, pop-ups and the keyboard", [
    ["header", "HEADER_BACKGROUND"], ["footer", "FOOTER_BACKGROUND"], ["help", "HELP_BACKGROUND"], ["notification", "MSG_BACKGROUND"],
    ["dialogue", "DIALOGUE_BACKGROUND"], ["keyboard", "OSK_BACKGROUND"], ["bar", "BAR_BACKGROUND"], ["counter", "COUNTER_BACKGROUND"],
    ["charging", "CHARGER_BACKGROUND"], ["help", "HELP_BORDER"], ["dialogue", "DIALOGUE_BORDER"], ["bar", "BAR_BORDER"],
    ["keyboard", "OSK_ITEM_BORDER"], ["roll", "ROLL_BORDER_COLOUR"], ["counter", "COUNTER_BORDER_COLOUR"],
  ]],
  ["accent", "Accent", "The selected item, button hints and highlights", [
    ["list", "LIST_FOCUS_BACKGROUND"], ["list", "LIST_FOCUS_INDICATOR"], ["grid", "CELL_FOCUS_BACKGROUND"], ["grid", "CELL_FOCUS_BACKGROUND_GRADIENT_COLOR"],
    ["grid", "CELL_FOCUS_BORDER"], ["keyboard", "OSK_ITEM_BACKGROUND_FOCUS"], ["keyboard", "OSK_ITEM_BORDER_FOCUS"], ["keyboard", "OSK_BORDER"],
    ["bar", "BAR_PROGRESS_ACTIVE_BACKGROUND"], ["bar", "BAR_ICON"], ["help", "HELP_TITLE"], ["dialogue", "DIALOGUE_TITLE"],
    ["dialogue", "DIALOGUE_SELECTION"], ["network", "NETWORK_ACTIVE"], ["bluetooth", "BLUETOOTH_ACTIVE"], ["notification", "MSG_BORDER"],
    ["roll", "ROLL_SELECT_BACKGROUND"], ["grid", "CURRENT_ITEM_LABEL_BORDER"],
    ...BUTTONS.map(([b]) => ["navigation", `NAV_${b}_GLYPH`]),
  ]],
  ["text", "Text", "Item names, titles, the clock and button hints", [
    ["list", "LIST_DEFAULT_TEXT"], ["list", "LIST_DEFAULT_GLYPH_RECOLOUR"], ["header", "HEADER_TEXT"], ["footer", "FOOTER_TEXT"],
    ["date", "DATETIME_TEXT"], ["grid", "CELL_DEFAULT_TEXT"], ["notification", "MSG_TEXT"], ["keyboard", "OSK_TEXT"],
    ["counter", "COUNTER_TEXT"], ["charging", "CHARGER_TEXT"], ["battery", "BATTERY_NORMAL"], ["help", "HELP_CONTENT"],
    ["dialogue", "DIALOGUE_CONTENT"], ["roll", "ROLL_TEXT"], ["verbose", "VERBOSE_BOOT_TEXT"],
    ...BUTTONS.map(([b]) => ["navigation", `NAV_${b}_TEXT`]),
  ]],
  ["onAccent", "Text on the accent", "Names on the selected item", [
    ["list", "LIST_FOCUS_TEXT"], ["list", "LIST_FOCUS_GLYPH_RECOLOUR"], ["grid", "CELL_FOCUS_TEXT"], ["keyboard", "OSK_TEXT_FOCUS"],
    ["grid", "CURRENT_ITEM_LABEL_TEXT"], ["roll", "ROLL_SELECT_TEXT"],
  ]],
  ["muted", "Quiet details", "Disabled items, progress tracks and idle icons", [
    ["list", "LIST_DISABLED_TEXT"], ["list", "LIST_DEFAULT_INDICATOR"], ["bar", "BAR_PROGRESS_BACKGROUND"], ["network", "NETWORK_NORMAL"],
    ["bluetooth", "BLUETOOTH_NORMAL"], ["dialogue", "DIALOGUE_OPTION"],
  ]],
];

/** Sizes set together by Quick style: [id, label, min, max, [section, key] list]. */
export const QUICK_SIZES = [
  ["radius", "Roundness", 0, 24, [
    ["list", "LIST_DEFAULT_RADIUS"], ["help", "HELP_RADIUS"], ["notification", "MSG_RADIUS"], ["keyboard", "OSK_RADIUS"], ["keyboard", "OSK_ITEM_RADIUS"],
    ["bar", "BAR_RADIUS"], ["bar", "BAR_PROGRESS_RADIUS"], ["grid", "CELL_RADIUS"], ["dialogue", "DIALOGUE_RADIUS_MAIN"], ["counter", "COUNTER_RADIUS"],
    ["roll", "ROLL_RADIUS"], ["roll", "ROLL_SELECT_RADIUS"], ["grid", "CURRENT_ITEM_LABEL_RADIUS"],
  ]],
  ["items", "Items per page", 5, 13, [["misc", "CONTENT_ITEM_COUNT"]]],
  ["header", "Header height", 0, 120, [["header", "HEADER_HEIGHT"]]],
  ["footer", "Footer height", 0, 120, [["footer", "FOOTER_HEIGHT"]]],
];

/** Settings every new theme starts with, before a palette fills in the colours: a flat, modern look. */
export const STARTER = {
  background: { BACKGROUND_ALPHA: 255, BACKGROUND_GRADIENT_DIRECTION: 0 },
  header: { HEADER_BACKGROUND_ALPHA: 255, HEADER_TEXT_ALPHA: 255, HEADER_TEXT_ALIGN: 2 },
  footer: { FOOTER_BACKGROUND_ALPHA: 255, FOOTER_TEXT_ALPHA: 255 },
  list: {
    LIST_DEFAULT_RADIUS: 8, LIST_DEFAULT_BACKGROUND_ALPHA: 0, LIST_DEFAULT_GRADIENT_START: 255, LIST_DEFAULT_INDICATOR_ALPHA: 0,
    LIST_DEFAULT_GLYPH_RECOLOUR_ALPHA: 255, LIST_FOCUS_BACKGROUND_ALPHA: 255, LIST_FOCUS_GRADIENT_START: 255,
    LIST_FOCUS_INDICATOR_ALPHA: 0, LIST_FOCUS_GLYPH_RECOLOUR_ALPHA: 255, LIST_DEFAULT_SHADOW_ALPHA: 0, LIST_FOCUS_SHADOW_ALPHA: 0,
  },
  navigation: { ALIGNMENT: 2 },
  misc: { CONTENT_ITEM_COUNT: 9, CONTENT_PADDING_LEFT: 8, CONTENT_WIDTH: 0 },
  counter: { COUNTER_ALIGNMENT: 2, COUNTER_TEXT_ALPHA: 0 },
};

/** Ready-made colours: [name, bg, bars, accent, text, text on accent, quiet]. */
export const PALETTES = [
  ["Mustard", "282525", "100808", "CBAA0F", "FFFFFF", "100808", "7E730C"],
  ["Midnight", "0F172A", "0B1120", "38BDF8", "E2E8F0", "0B1120", "475569"],
  ["Vampire", "282A36", "21222C", "BD93F9", "F8F8F2", "21222C", "6272A4"],
  ["Mint", "0F1F1A", "0A1512", "34D399", "ECFDF5", "052E21", "3F6B5C"],
  ["Sakura", "2B1B24", "1F121A", "F472B6", "FCE7F3", "2B1B24", "9D5C7D"],
  ["Ember", "1C1210", "120B0A", "F97316", "FFEDD5", "1C1210", "7C4A32"],
  ["Pocket", "9BBC0F", "8BAC0F", "306230", "0F380F", "9BBC0F", "6A8F2A"],
  ["Paper", "F4F1EA", "E4DED2", "C2410C", "1C1917", "FFFFFF", "A8A29E"],
];

// ---------------------------------------------------------------- screens and files

/** Screens the preview can draw: [id, label, the MustardOS program whose scheme applies]. */
export const SCREENS = [
  ["muxlaunch", "Main menu", "muxlaunch"], ["muxplore", "Explore content", "muxplore"], ["muxconfig", "Configuration", "muxconfig"],
  ["muxtweakgen", "General settings", "muxtweakgen"], ["popups", "Pop-ups", "muxconfig"], ["keyboard", "Keyboard", "muxnetprofile"],
  ["passcode", "Passcode", "muxpass"], ["muxcharge", "Charging", "muxcharge"], ["boot", "Boot logo", ""],
];

/** MustardOS programs a scheme or wallpaper can target: [program, name]. */
export const PROGRAMS = [
  ["muxlaunch", "Main menu"], ["muxplore", "Explore content"], ["muxcollect", "Collections"], ["muxhistory", "History"],
  ["muxapp", "Applications"], ["muxinfo", "Information"], ["muxconfig", "Configuration"], ["muxcustom", "Customisation"],
  ["muxtweakgen", "General settings"], ["muxtweakadv", "Advanced settings"], ["muxvisual", "Interface options"], ["muxpicker", "Theme and catalogue picker"],
  ["muxtheme", "Themes"], ["muxthemedown", "Theme download"], ["muxnetwork", "Wi-Fi"], ["muxnetprofile", "Network profiles"],
  ["muxnetscan", "Network scan"], ["muxnetinfo", "Network details"], ["muxconnect", "Connectivity"], ["muxwebserv", "Web services"],
  ["muxpower", "Power"], ["muxrtc", "Date and time"], ["muxtimezone", "Time zone"], ["muxlanguage", "Language"],
  ["muxstorage", "Storage"], ["muxbackup", "Backup"], ["muxarchive", "Archive manager"], ["muxtask", "Task toolkit"],
  ["muxsysinfo", "System details"], ["muxsearch", "Search"], ["muxtag", "Tags"], ["muxoption", "Content options"],
  ["muxassign", "Assign core"], ["muxgov", "Governor"], ["muxcontrol", "Control scheme"], ["muxkiosk", "Kiosk"],
  ["muxhdmi", "HDMI"], ["muxshot", "Screenshots"], ["muxspace", "Storage space"], ["muxtester", "Input tester"],
  ["muxpass", "Passcode"], ["muxcharge", "Charging"], ["muxstart", "Start"], ["muxmessage", "Messages"], ["muxactivity", "Activity"],
];

export const LAUNCH_ITEMS = [["explore", "Explore Content"], ["collection", "Collections"], ["history", "History"], ["apps", "Applications"], ["info", "Information"], ["config", "Configuration"], ["reboot", "Reboot Device"], ["shutdown", "Shutdown Device"]];

/** Pictures a theme can carry: [path under image/, name, hint]. */
export const IMAGE_SLOTS = [
  ["wall/default.png", "Wallpaper", "Behind every screen that has no wallpaper of its own."],
  ["bootlogo.png", "Boot logo", "Shown while the handheld starts. MustardOS converts it for the boot partition."],
  ["charge.png", "Charging logo", "Shown when the handheld charges while off. The boot logo is used when there is none."],
  ["wall/muxcharge.png", "Charging screen", "Wallpaper of the charging screen."],
  ["overlay.png", "Overlay", "Laid over everything when the handheld's overlay setting asks for the theme's."],
  ["screensaver.png", "Screen saver", "Shown when the screen saver starts."],
  ["reboot.png", "Rebooting", "Shown while the handheld restarts."],
  ["shutdown.png", "Shutting down", "Shown while the handheld powers off."],
  ["static/default.png", "Static picture", "Sits on top of screens without their own, placed by Static alignment."],
];

/** Known glyph names per folder; other folders take any name the frontend asks for. */
export const GLYPHS = {
  muxlaunch: LAUNCH_ITEMS.map(([id]) => id),
  footer: ["a", "b", "c", "x", "y", "z", "menu", "lr", "ud"],
  header: ["network_normal", "network_active", "bluetooth", ...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].flatMap((n) => [`capacity_${n}`, `capacity_charging_${n}`])],
  bar: ["volume_0", "volume_1", "volume_2", "volume_3", "bright_0", "bright_1", "bright_2", "bright_3"],
  muxconfig: ["general", "connect", "custom", "interface", "language", "power", "storage", "backup", "overlay", "colour", "theme"],
};

export const FONT_SLOTS = [
  ["font/default.bin", "Everything", "Used wherever no other font is set."],
  ["font/panel/default.bin", "List items", "The names in lists."],
  ["font/header/default.bin", "Header", "The title and clock."],
  ["font/footer/default.bin", "Footer", "The button hints."],
];

export const SOUNDS = [
  ["navigate", "Moving with the arrows"], ["confirm", "Choosing an item"], ["back", "Going back"], ["option", "Changing an option"],
  ["keypress", "Keyboard key"], ["info_open", "Opening an info window"], ["info_close", "Closing an info window"], ["error", "Error"],
  ["startup", "Start-up"], ["reboot", "Rebooting"], ["shutdown", "Shutting down"], ["muos", "A secret"],
];
