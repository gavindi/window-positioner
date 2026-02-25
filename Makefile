.PHONY: all clean dist install uninstall reload help

EXTENSION_UUID := window-positioner@gavindi.github.com
BUILD_DIR := build
SCHEMA_DIR := schemas
SCHEMA_FILE := $(SCHEMA_DIR)/org.gnome.shell.extensions.window-positioner.gschema.xml

all: help

help:
	@echo "Targets:"
	@echo "  dist      Build distributable zip in $(BUILD_DIR)/"
	@echo "  install   Install extension locally"
	@echo "  reload    Install and hot-reload extension (Wayland-safe)"
	@echo "  uninstall Remove extension"
	@echo "  clean     Remove build output"

dist: $(BUILD_DIR)/$(EXTENSION_UUID).zip

$(BUILD_DIR)/$(EXTENSION_UUID).zip: extension.js prefs.js metadata.json README.md CHANGELOG.md $(SCHEMA_FILE)
	mkdir -p $(BUILD_DIR)/$(EXTENSION_UUID)
	cp extension.js prefs.js metadata.json README.md CHANGELOG.md $(BUILD_DIR)/$(EXTENSION_UUID)/
	cp -r $(SCHEMA_DIR) $(BUILD_DIR)/$(EXTENSION_UUID)/
	glib-compile-schemas $(BUILD_DIR)/$(EXTENSION_UUID)/$(SCHEMA_DIR)
	cd $(BUILD_DIR)/$(EXTENSION_UUID) && zip -r ../$(EXTENSION_UUID).zip .
	rm -rf $(BUILD_DIR)/$(EXTENSION_UUID)

install: $(BUILD_DIR)/$(EXTENSION_UUID).zip
	gnome-extensions install --force $(BUILD_DIR)/$(EXTENSION_UUID).zip

reload: install
	gnome-extensions disable $(EXTENSION_UUID) || true
	gnome-extensions enable $(EXTENSION_UUID)

uninstall:
	gnome-extensions uninstall $(EXTENSION_UUID) || true

clean:
	rm -rf $(BUILD_DIR)
