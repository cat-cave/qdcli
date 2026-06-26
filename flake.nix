{
  description = "qdcli dev environment (Node/pnpm monorepo)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { flake-utils, nixpkgs, ... }:
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-darwin"
      ]
      (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          nodejs = pkgs.nodejs_24;
          pnpm = pkgs.pnpm_11;
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./apps
              ./docs
              ./packages
              ./scripts
              ./package.json
              ./pnpm-lock.yaml
              ./pnpm-workspace.yaml
              ./tsconfig.base.json
              ./tsconfig.json
              ./vite.config.ts
              ./vitest.config.ts
            ];
          };
          qd = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "qd";
            version = "0.1.9";

            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 3;
              hash = "sha256-nIQxK+K42EUJ0HR0HqDoj5wzkjg/v4jBO6LDFkKcKsk=";
            };

            nativeBuildInputs = [
              pkgs.cacert
              pkgs.makeWrapper
              nodejs
              pnpm
              pkgs.pnpmConfigHook
            ];

            env.SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";

            buildPhase = ''
              runHook preBuild

              pnpm run build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              install -Dm755 packages/cli/dist/index.mjs "$out/lib/qd/index.mjs"
              install -Dm644 packages/cli/package.json "$out/lib/qd/package.json"
              cp -r packages/cli/dist/viewer "$out/lib/qd/viewer"
              mkdir -p "$out/lib/qd/node_modules/@cat-cave/qdcli-core"
              cp -r packages/core/dist packages/core/package.json "$out/lib/qd/node_modules/@cat-cave/qdcli-core/"
              mkdir -p "$out/lib/qd/node_modules/@tursodatabase"
              cp -rL node_modules/.pnpm/@tursodatabase+database@*/node_modules/@tursodatabase/database \
                "$out/lib/qd/node_modules/@tursodatabase/"
              for pkg in node_modules/.pnpm/@tursodatabase+database-*@*/node_modules/@tursodatabase/database-*; do
                if [ -e "$pkg" ]; then
                  cp -rL "$pkg" "$out/lib/qd/node_modules/@tursodatabase/"
                fi
              done
              makeWrapper ${pkgs.lib.getExe nodejs} "$out/bin/qd" \
                --add-flags "$out/lib/qd/index.mjs"

              runHook postInstall
            '';

            doInstallCheck = true;
            nativeInstallCheckInputs = [ nodejs ];
            installCheckPhase = ''
              runHook preInstallCheck

              "$out/bin/qd" --version
              "$out/bin/qd" view --check --json
              tmpdir="$(mktemp -d)"
              cd "$tmpdir"
              "$out/bin/qd" init --json
              "$out/bin/qd" status --json

              runHook postInstallCheck
            '';

            meta = {
              description = "Quick DAG CLI for orchestrator-led agentic project work";
              homepage = "https://github.com/cat-cave/qdcli";
              license = pkgs.lib.licenses.mit;
              mainProgram = "qd";
            };
          });
        in
        {
          packages = {
            inherit qd;
            default = qd;
          };

          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs
              just
              git
              gh
              pkg-config
              openssl
            ];

            shellHook = ''
              export COREPACK_HOME="$PWD/.corepack"
              mkdir -p "$COREPACK_HOME/bin"
              corepack enable --install-directory "$COREPACK_HOME/bin" pnpm 2>/dev/null || true
              export PATH="$COREPACK_HOME/bin:$PATH"
              echo "qdcli devshell - node $(node -v); pnpm via corepack"
            '';
          };
        }
      );
}
