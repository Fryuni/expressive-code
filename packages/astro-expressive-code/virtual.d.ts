declare module 'virtual:astro-expressive-code/styles' {
	export const styles: [string, string][]
}

declare module 'virtual:astro-expressive-code/scripts' {
	export const scripts: [string, string][]
}

declare module 'virtual:astro-expressive-code/config' {
	import type { AstroExpressiveCodeOptions, PartialAstroConfig } from 'astro-expressive-code'
	export const astroConfig: PartialAstroConfig
	export const ecConfigFileOptions: AstroExpressiveCodeOptions
	export const ecIntegrationOptions: AstroExpressiveCodeOptions
}

declare module 'virtual:astro-expressive-code/api' {
	export const createAstroRenderer: typeof import('astro-expressive-code').createAstroRenderer
}
