import { fileURLToPath } from 'node:url'
import type { ViteUserConfig } from 'astro'
import { stableStringify } from 'remark-expressive-code'
import { findEcConfigFilePath } from './ec-config'
import { PartialAstroConfig, extractPartialAstroConfig } from './astro-config'
import { AstroExpressiveCodeOptions } from './ec-config'
import inlineMod, { defineModule } from '@inox-tools/inline-mod/vite';

/**
 * This Vite plugin provides access to page-wide styles & scripts that the Astro integration
 * extracted from its `RemarkExpressiveCodeRenderer`. We extract these contents from the renderer
 * to prevent the remark plugin from repeatedly injecting them into the HTML output of every page
 * while still allowing pages to load them on demand if they contain code blocks.
 *
 * All data is provided as virtual modules under the `virtual:astro-expressive-code/*` namespace,
 * which can be used by injected routes to generate CSS & JS files.
 */
export function vitePluginAstroExpressiveCode({
	styles,
	scripts,
	ecIntegrationOptions,
	astroConfig,
}: {
	styles: [string, string][]
	scripts: [string, string][]
	ecIntegrationOptions: AstroExpressiveCodeOptions
	astroConfig: PartialAstroConfig
}): NonNullable<ViteUserConfig['plugins']>[number] {
	defineModule('virtual:astro-expressive-code/scripts', {
		constExports: { scripts },
	});

	defineModule('virtual:astro-expressive-code/styles', {
		constExports: { styles },
	});

	console.log('Keys:', ecIntegrationOptions);

	defineModule('virtual:astro-expressive-code/config', {
		constExports: {
			astroConfig: extractPartialAstroConfig(astroConfig),
			ecIntegrationOptions,
		}
	})

	return [inlineMod(), {
		name: 'vite-plugin-astro-expressive-code',
		resolveId: (id) => {
			// Resolve virtual API module to the current package entrypoint
			if (id === 'virtual:astro-expressive-code/api') return fileURLToPath(import.meta.url)
		},
	}];
}
