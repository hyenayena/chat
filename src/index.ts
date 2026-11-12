import type {Logger, ModulePlugin} from '../../../src/api.js';
import {createChatCommands} from './commands.js';
import * as kit from './kit.js';
import {noopLog} from './log.js';
import {setActivityEvents} from './activity.js';
import {setModuleSessionLog} from './module-sessions.js';
import {chatGallerySection, diffGallerySection, layoutGallerySection, planGallerySection, statusGallerySection, toolsGallerySection} from './ui/gallery.js';
import {markdownGallerySection} from './ui/markdown-gallery.js';

// The gallery is optional: an older core has no registry, and a failure here must not stop the plugin.
function registerGallery(log: Logger): void {
	try {
		if (typeof kit.registerGallerySection !== 'function') {
			log.warn('gallery section skipped');
			return;
		}
		for (const section of [chatGallerySection, diffGallerySection, toolsGallerySection, statusGallerySection, planGallerySection, layoutGallerySection, markdownGallerySection]) {
			if (!kit.registerGallerySection(section)) log.warn('gallery section skipped', {section: section.name});
		}
	} catch (err) {
		log.warn('gallery section skipped', {err});
	}
}

const plugin: ModulePlugin = host => {
	const log = host.log ?? noopLog;
	log.info('plugin loaded');
	setModuleSessionLog(log);
	setActivityEvents(host.events);
	registerGallery(log);
	return createChatCommands({dataDir: host.dataDir, log, ...(host.devFailure && {devFailure: host.devFailure}), flow: host.build ? {build: host.build} : {}});
};

export default plugin;
