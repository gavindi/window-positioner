.PHONY: all clean dist install uninstall

EXTENSION_UUID := window-positioner@gavindi.github.com
BUILD_DIR := build
SCHEMA_DIR := schemas
SCHEMA_FILE := $(SCHEMA_DIR)/org.gnome.shell.extensions.window-positioner.gschema.xml
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
USER_SCHEMA_DIR := $(HOME)/.local/share/glib-2.0/schemas

all: dist

dist: $(BUILD_DIR)/$(EXTENSION_UUID).zip

$(BUILD_DIR)/$(EXTENSION_UUID).zip: extension.js prefs.js metadata.json README.md $(SCHEMA_FILE) Makefile
	mkdir -p $(BUILD_DIR)/$(EXTENSION_UUID)
	cp extension.js prefs.js metadata.json Makefile README.md $(BUILD_DIR)/$(EXTENSION_UUID)/
	cp -r $(SCHEMA_DIR) $(BUILD_DIR)/$(EXTENSION_UUID)/
	glib-compile-schemas $(BUILD_DIR)/$(EXTENSION_UUID)/$(SCHEMA_DIR)
	cd $(BUILD_DIR) && zip -r $(EXTENSION_UUID).zip $(EXTENSION_UUID)/
	rm -rf $(BUILD_DIR)/$(EXTENSION_UUID)

install: $(BUILD_DIR)/$(EXTENSION_UUID).zip
	gnome-extensions install --force $(BUILD_DIR)/$(EXTENSION_UUID).zip
	mkdir -p $(USER_SCHEMA_DIR)
	cp $(SCHEMA_FILE) $(USER_SCHEMA_DIR)/
	glib-compile-schemas $(USER_SCHEMA_DIR)

uninstall:
	gnome-extensions uninstall $(EXTENSION_UUID) || true
	rm -f $(USER_SCHEMA_DIR)/$(notdir $(SCHEMA_FILE))
	glib-compile-schemas $(USER_SCHEMA_DIR)

clean:
	rm -rf $(BUILD_DIR)
