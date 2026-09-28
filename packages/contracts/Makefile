build:
	cargo build --release --target wasm32-unknown-unknown
	wasm-opt -Oz -o target/wasm32-unknown-unknown/release/$(notdir $@).opt target/wasm32-unknown-unknown/release/$@

verify:
	@for wasm in target/wasm32-unknown-unknown/release/*.wasm; do \
		name=\$$(basename \"\$$wasm\"); \
		size=\$$(wc -c < \"\$$wasm\" | awk '{print \$1}'); \
		echo "\$$name: \$$size bytes"; \
		sha256sum \"\$$wasm\" | awk '{print \$1}' > \"\$$name.sha256\" && \
		echo "SHA-256: \$$(cat \"\$$name.sha256\")"; \
		[ \"\$$size\" -gt 50000 ] && exit 1; \
	done

clean:
	cargo clean
	rm -rf target/wasm32-unknown-unknown/release/*.opt
