FRONTEND_DIR := frontend
CONTRACT_DIR := contracts/subscription
TARGET_DIR   := contracts/target
WASM_PATH    := $(TARGET_DIR)/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

.PHONY: build test test-frontend clean

## build: Compile the Soroban subscription contract to WASM (release profile)
build:
	cargo build \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml \
		--target wasm32-unknown-unknown \
		--release
	@test -f "$(WASM_PATH)" || \
		(echo "ERROR: WASM artifact not found at $(WASM_PATH)" >&2; exit 1)

## test: Run the full contract test suite (unit + property-based tests)
test:
	cargo test \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml

## clean: Remove all build artifacts
clean:
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml

## test-frontend: Run the frontend Jest test suite (unit + load tests)
test-frontend:
	cd $(FRONTEND_DIR) && npm run test
