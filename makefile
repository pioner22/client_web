SHELL := /usr/bin/env bash
.SHELLFLAGS := -o pipefail -c

# ===== Web client (Vite) =====
WEB_CLIENT_PORT ?= 5173
VITE_HOST ?= 0.0.0.0

# ===== Local gateway defaults =====
WS_GATEWAY_HOST ?= 127.0.0.1
WS_GATEWAY_PORT ?= 8787
GATEWAY_URL ?= ws://$(WS_GATEWAY_HOST):$(WS_GATEWAY_PORT)/ws

# TCP server target for WS gateway
TCP_SERVER_ADDR ?= 127.0.0.1:$(SERVER_PORT)
TCP_TLS ?= 0
TCP_TLS_INSECURE ?= 0

# ===== Local TCP server port (used by root make targets) =====
SERVER_PORT ?= 7777

ROOT_DIR := $(abspath $(CURDIR)/..)

.PHONY: help deps dev typecheck build preview web-local web-remote web-check ws-gateway-run

help:
	@echo "Web client (client-web/) commands:"
	@echo "  make deps                         # npm install"
	@echo "  make dev                          # Vite dev server (needs WS gateway)"
	@echo "  make typecheck                 
	
# tsc --noEmit"
	@echo "  make build                        # vite build"
	@echo "  make preview                      # vite preview"
	@echo ""
	@echo "End-to-end local run (from root Makefile):"
	@echo "  make web-local                    # TCP server + WS gateway + Vite dev"
	@echo "  make web-remote TCP_SERVER_ADDR=yagodka.org:7777 TCP_TLS=1  # WS gateway -> remote TCP server + Vite dev"
	@echo "  make web-check                    # pytest + typecheck + build"
	@echo ""
	@echo "Vars:"
	@echo "  WS_GATEWAY_HOST=127.0.0.1 WS_GATEWAY_PORT=8787 WEB_CLIENT_PORT=5173 SERVER_PORT=7777"
	@echo "  TCP_SERVER_ADDR=127.0.0.1:7777 TCP_TLS=0 TCP_TLS_INSECURE=0"

deps:
	npm install

dev: deps
	VITE_GATEWAY_URL="$(GATEWAY_URL)" npm run dev -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

typecheck: deps
	npm run typecheck

build: deps
	npm run build

preview: deps
	npm run preview -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

# Delegate to repo-root Makefile so the whole stack can be started/tested.
web-local:
	$(MAKE) -C $(ROOT_DIR) web-local PORT=$(SERVER_PORT) WEB_CLIENT_PORT=$(WEB_CLIENT_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT)

web-remote:
	$(MAKE) -C $(ROOT_DIR) web-remote WEB_CLIENT_PORT=$(WEB_CLIENT_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT) TCP_SERVER_ADDR=$(TCP_SERVER_ADDR) TCP_TLS=$(TCP_TLS) TCP_TLS_INSECURE=$(TCP_TLS_INSECURE)

web-check:
	$(MAKE) -C $(ROOT_DIR) web-check

ws-gateway-run:
	$(MAKE) -C $(ROOT_DIR) ws-gateway-run PORT=$(SERVER_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT) TCP_SERVER_ADDR=$(TCP_SERVER_ADDR) TCP_TLS=$(TCP_TLS) TCP_TLS_INSECURE=$(TCP_TLS_INSECURE)
