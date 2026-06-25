SHELL := /usr/bin/env bash
.SHELLFLAGS := -o pipefail -c

WEB_CLIENT_PORT ?= 5173
VITE_HOST ?= 0.0.0.0
WS_GATEWAY_HOST ?= 127.0.0.1
WS_GATEWAY_PORT ?= 8787
GATEWAY_URL ?= ws://$(WS_GATEWAY_HOST):$(WS_GATEWAY_PORT)/ws
SERVER_PORT ?= 7777
TCP_SERVER_ADDR ?= 127.0.0.1:$(SERVER_PORT)
TCP_TLS ?= 0
TCP_TLS_INSECURE ?= 0

ROOT_DIR := $(abspath $(CURDIR)/..)

.PHONY: help deps dev typecheck test build preview web-local web-remote web-check ws-gateway-run

help:
	@echo "Yagodka Web/PWA client commands:"
	@echo "  make deps                         # npm install"
	@echo "  make dev                          # Vite dev server"
	@echo "  make typecheck                    # tsc --noEmit"
	@echo "  make test                         # node test runner"
	@echo "  make build                        # Vite/PWA build"
	@echo "  make preview                      # Vite preview"
	@echo "  make web-local                    # root local stack"
	@echo "  make web-remote                   # root stack against remote TCP"

deps:
	npm install

dev: deps
	VITE_GATEWAY_URL="$(GATEWAY_URL)" npm run dev -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

typecheck: deps
	npm run typecheck

test: deps
	npm run test

build: deps
	npm run build

preview: deps
	npm run preview -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

web-local:
	$(MAKE) -C $(ROOT_DIR) web-local PORT=$(SERVER_PORT) WEB_CLIENT_PORT=$(WEB_CLIENT_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT)

web-remote:
	$(MAKE) -C $(ROOT_DIR) web-remote WEB_CLIENT_PORT=$(WEB_CLIENT_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT) TCP_SERVER_ADDR=$(TCP_SERVER_ADDR) TCP_TLS=$(TCP_TLS) TCP_TLS_INSECURE=$(TCP_TLS_INSECURE)

web-check:
	$(MAKE) -C $(ROOT_DIR) web-check

ws-gateway-run:
	$(MAKE) -C $(ROOT_DIR) ws-gateway-run PORT=$(SERVER_PORT) WS_GATEWAY_HOST=$(WS_GATEWAY_HOST) WS_GATEWAY_PORT=$(WS_GATEWAY_PORT) TCP_SERVER_ADDR=$(TCP_SERVER_ADDR) TCP_TLS=$(TCP_TLS) TCP_TLS_INSECURE=$(TCP_TLS_INSECURE)
