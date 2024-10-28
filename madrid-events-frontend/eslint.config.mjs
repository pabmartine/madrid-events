import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
  { files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "script" }},
  { languageOptions: { globals: globals.browser }},
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    plugins: { prettier },
    rules: {
      ...prettierConfig.rules,
      "prettier/prettier": "error",
      "@next/next/no-img-element": "off", // Desactiva la advertencia de <img>
      "react-hooks/exhaustive-deps": "off", // Desactiva la advertencia de dependencias en hooks
      "@typescript-eslint/no-unused-vars": "off" // Desactiva advertencias de variables no usadas
    }
  }
];
