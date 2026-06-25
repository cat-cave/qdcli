{
  description = "qdcli dev environment (Node/pnpm monorepo)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
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
    };
}

