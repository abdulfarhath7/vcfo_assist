// Types shared by the panel shell and its views.

/** @typedef {import('../shared/schema.js').PanelSnapshot} PanelSnapshot */
/** @typedef {import('../shared/schema.js').PanelRequest} PanelRequest */
/** @typedef {import('../shared/schema.js').AssistError} AssistError */

/**
 * @typedef {'import' | 'verify' | 'autofill' | 'gate' | 'capture'} Stage
 */

/**
 * @typedef {object} UiState
 * @property {Stage} stage
 * @property {boolean} busy
 * @property {AssistError | null} error
 * @property {boolean} stopping
 */

/**
 * @typedef {object} ViewContext
 * @property {PanelSnapshot} snap
 * @property {UiState} ui
 * @property {(req: PanelRequest) => Promise<import('../shared/result.js').Result<unknown>>} request
 * @property {() => Promise<void>} refresh
 * @property {(err: AssistError | string | null) => void} setError
 * @property {(stage: Stage) => void} goto
 * @property {(busy: boolean) => void} setBusy
 * @property {() => Promise<import('../shared/result.js').Result<number>>} activeTabId
 * @property {() => void} rerender
 */

/**
 * @typedef {object} PrimaryAction
 * @property {string} label
 * @property {boolean} disabled
 * @property {() => Promise<void> | void} onClick
 */

/**
 * @typedef {object} View
 * @property {(root: HTMLElement, ctx: ViewContext) => void} render
 * @property {(ctx: ViewContext) => PrimaryAction | null} primary
 */

export {};
