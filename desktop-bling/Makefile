UUID := taskbar-spartan@desktop-bling.local
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: schemas install uninstall enable disable preview test snapshot logs pack sandbox sandbox-bench

schemas:
	glib-compile-schemas schemas/

install: schemas
	mkdir -p $(dir $(DEST))
	ln -sfn $(CURDIR) $(DEST)
	@echo "Installed. On Wayland, log out and back in once, then: make enable"

uninstall:
	rm -f $(DEST)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

preview:
	gjs -m dev/preview.js

test:
	gjs -m dev/simtest.js 300

snapshot:
	gjs -m dev/snapshot.js .

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

sandbox:
	dev/sandbox.sh shots

sandbox-bench:
	dev/sandbox.sh bench

pack: schemas
	gnome-extensions pack --force --extra-source=engine --extra-source=render \
		--extra-source=icons --extra-source=README.md .
