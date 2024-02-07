let cachedRenderer: ReturnType<typeof createRenderer> | undefined = undefined

export async function getRenderer() {
	if (!cachedRenderer) {
		cachedRenderer = createRenderer()
	}
	return await cachedRenderer
}

async function createRenderer() {
	const { astroConfig, ecIntegrationOptions = {} } = await import('virtual:astro-expressive-code/config')
	const { createAstroRenderer } = await import('virtual:astro-expressive-code/api')

	return await createAstroRenderer({
		astroConfig,
		ecConfig: ecIntegrationOptions,
	})
}
