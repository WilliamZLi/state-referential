// src/pipeline/WorldBinder.js
/**
 * WorldBinder — handles the chat↔World binding lifecycle:
 *   bindCurrentChat(worldId)         — writes worldId + role to chatMetadata, runs migration if needed
 *   bindCurrentChatToNewWorld(name)  — creates a new World, then binds
 *   unbindCurrentChat()              — clears worldId from chatMetadata, copies state back to chat
 */
export class WorldBinder {
  constructor(engine, worldRegistry, worldBinding, deps) {
    this.engine = engine;
    this.registry = worldRegistry;
    this.worldBinding = worldBinding;
    this.deps = deps;
    // deps: { getChatMetadata, saveChatConditional, ctx,
    //         getChronicle, setChronicle, serverApi }
  }

  async bindCurrentChat(worldId, role = 'mainline') {
    const world = this.registry.get(worldId);
    if (!world) throw new Error(`world not found: ${worldId}`);

    // Data migration: if chat already has Layer 1 state, seed the world with it.
    const chatMeta = this.deps.getChatMetadata?.() ?? {};
    const existingTrackers = chatMeta.trackers;
    if (existingTrackers && !world.mainlineChatId) {
      // Fresh world: seed it with current chat's tracker state.
      await this.deps.serverApi?.putResource(worldId, 'values', existingTrackers.values ?? {});
      await this.deps.serverApi?.putResource(worldId, 'descriptions', existingTrackers.descriptions ?? { global: {}, perSubject: {} });
      await this.deps.serverApi?.patchMeta(worldId, {
        subjects: existingTrackers.subjects ?? { subjects: [], protagonistId: null },
        sceneTags: existingTrackers.sceneTags ?? [],
      });
    }

    // Mark chat as bound
    chatMeta.trackerWorldId = worldId;
    chatMeta.trackerChatRole = role;
    this.deps.saveChatConditional?.();

    // Update world's mainlineChatId if needed
    if (role === 'mainline' && !world.mainlineChatId) {
      await this.registry.setMainlineChatId(worldId, chatMeta.id ?? 'unknown');
    }

    // Reload backend
    const backend = await this.worldBinding.selectBackend(chatMeta);
    backend.invalidate?.();
    this.engine.setStorageBackend(backend);
  }

  async bindCurrentChatToNewWorld(name) {
    const world = await this.registry.create({ name });
    await this.bindCurrentChat(world.id, 'mainline');
    return world;
  }

  async unbindCurrentChat() {
    const chatMeta = this.deps.getChatMetadata?.() ?? {};
    // Copy current world state back into chat.trackers so the chat remains coherent.
    if (this.worldBinding.currentWorldId) {
      chatMeta.trackers = {
        subjects:     this.engine.subjects.backend.loadSubjects?.() ?? { subjects: [], protagonistId: null },
        values:       this.engine.values.backend.loadValues?.() ?? {},
        descriptions: this.engine.values.backend.loadDescriptions?.() ?? { global: {}, perSubject: {} },
        sceneTags:    this.engine.tags.backend.loadSceneTags?.() ?? [],
        snapshots:    this.engine.snapshots.backend.loadSnapshots?.() ?? {},
      };
    }
    delete chatMeta.trackerWorldId;
    delete chatMeta.trackerChatRole;
    this.deps.saveChatConditional?.();

    // Revert to chat-scoped backend
    const backend = await this.worldBinding.selectBackend(chatMeta);
    backend.invalidate?.();
    this.engine.setStorageBackend(backend);
  }
}
