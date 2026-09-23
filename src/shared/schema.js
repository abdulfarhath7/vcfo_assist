// JSDoc typedefs shared across the extension. This file has no runtime
// behaviour beyond the `export {}` that makes it a module.
//
// Recipes and field maps are data. Their shapes are defined here so the loader,
// the engine and the panel agree; the values arrive later as JSON files.

/* ------------------------------------------------------------------------ */
/* Errors                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Failure taxonomy from docs/05. Every failure names its class so the panel
 * can say what kind of thing went wrong.
 * @typedef {'precondition' | 'resolution' | 'ambiguity' | 'timeout'
 *   | 'verification' | 'guard' | 'credential' | 'transport'
 *   | 'validation' | 'auth' | 'version' | 'internal'} ErrorClass
 */

/**
 * @typedef {object} AssistError
 * @property {ErrorClass} class
 * @property {string} message      Names the field key and selector. Never a value.
 * @property {string} [field]      Field key, when the failure is about a field.
 * @property {string[]} [selectors] Every selector tried, in order.
 * @property {number[]} [matchCounts] Match count per selector tried.
 * @property {string} [step]       Step label, when the failure is about a step.
 * @property {number} [stepIndex]
 * @property {number} [elapsedMs]
 * @property {string[]} [missing]  Missing keys, for validation failures.
 * @property {Record<string, string | number | boolean | null>} [details]
 */

/* ------------------------------------------------------------------------ */
/* Recipe                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {'click' | 'fill' | 'fillGroup' | 'select' | 'check'
 *   | 'waitFor' | 'waitForGone' | 'waitForUrl' | 'assert'
 *   | 'humanGate' | 'halt'} StepOp
 */

/**
 * One recipe step. Which arguments apply depends on `op`; see docs/04.
 * @typedef {object} Step
 * @property {StepOp} op
 * @property {string} [label]      Shown in the panel step list.
 * @property {string} [selector]   click, waitFor, waitForGone, assert
 * @property {string} [key]        fill, select, check — a field map key
 * @property {string} [section]    fillGroup — a field map section
 * @property {string | boolean} [value] check — desired state
 * @property {string} [pattern]    waitForUrl — RegExp source
 * @property {number} [timeoutMs]  waits
 * @property {string} [message]    assert, humanGate
 * @property {string} [reason]     halt
 */

/**
 * @typedef {object} Precondition
 * @property {'assertUrlMatches' | 'assertLoggedIn'} op
 * @property {string} [pattern]    assertUrlMatches — RegExp source
 * @property {string} [selector]   assertLoggedIn — element that exists only when logged in
 * @property {string} message      Shown when the precondition fails
 */

/**
 * @typedef {object} Recipe
 * @property {string} id
 * @property {number} version
 * @property {string} label
 * @property {string} origin
 * @property {string} requiresFieldMap          Field map id this recipe fills from
 * @property {number} [requiresFieldMapVersion] Minimum field map version (default 1)
 * @property {number} requiresSchemaVersion     Suite payload schemaVersion
 * @property {Precondition[]} preconditions
 * @property {Step[]} steps
 * @property {string} [_note]
 */

/* ------------------------------------------------------------------------ */
/* Field map                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {'stable' | 'likely' | 'fragile'} Stability
 */

/**
 * @typedef {object} Selectors
 * @property {string} primary
 * @property {string[]} fallbacks
 * @property {string[]} shadowPath   Hosts to descend through, outermost first
 * @property {Stability} stability
 */

/**
 * @typedef {'typed' | 'widget' | 'unknown'} EntryMode
 */

/**
 * @typedef {'listbox' | 'combobox' | 'datepicker' | 'radio' | 'checkbox' | 'native'} WidgetKind
 */

/**
 * @typedef {object} FieldEntry
 * @property {EntryMode} mode
 * @property {WidgetKind | null} [widgetKind]
 * @property {string} [listboxSelector] widget — where options appear once opened
 * @property {string} [optionSelector]  widget — option elements within the listbox
 */

/**
 * @typedef {'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'radio' | 'date' | 'email' | 'tel'} FieldType
 */

/**
 * @typedef {object} FieldDef
 * @property {string} key             Assist's identity for the field
 * @property {string} label
 * @property {string} sourceField     Suite's key in `payload.fields`
 * @property {boolean} optional
 * @property {FieldType} type
 * @property {number | null} maxLength
 * @property {string} transform       Pipe-separated names from TRANSFORMS
 * @property {FieldEntry} entry
 * @property {Selectors} selectors
 * @property {string[]} dependsOn     Keys that must be filled first
 * @property {string | null} loadingSelector Loader to wait out after dependencies change
 */

/**
 * @typedef {'jquery' | 'angular' | 'react' | 'aem' | 'unknown' | 'none'} Framework
 */

/**
 * @typedef {object} FieldMap
 * @property {string} id
 * @property {number} version
 * @property {string} origin
 * @property {Framework} framework
 * @property {number} requiresSchemaVersion
 * @property {string} capturedFrom
 * @property {Record<string, FieldDef[]>} sections
 * @property {string} [_note]
 */

/* ------------------------------------------------------------------------ */
/* Result recipe (return leg)                                                */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {object} ResultField
 * @property {string} key             srn | status | …
 * @property {string} label
 * @property {Selectors} selectors
 * @property {'text' | 'value' | 'attribute'} read
 * @property {string} [attribute]
 * @property {string} [pattern]       RegExp source; first capture group or whole match is kept
 * @property {boolean} optional
 */

/**
 * @typedef {object} ResultRecipe
 * @property {string} id
 * @property {number} version
 * @property {string} form
 * @property {string} label
 * @property {string} origin
 * @property {Precondition[]} preconditions
 * @property {ResultField[]} extract
 * @property {string} [_note]
 */

/* ------------------------------------------------------------------------ */
/* Suite payload                                                             */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {string | number | boolean | null} FieldValue
 */

/**
 * @typedef {object} SuiteEngagement
 * @property {string} id
 * @property {string} companyName
 * @property {string} stage
 */

/**
 * @typedef {object} SuitePayload
 * @property {number} schemaVersion
 * @property {string} suiteVersion
 * @property {string} form
 * @property {SuiteEngagement} engagement
 * @property {Record<string, FieldValue>} fields
 * @property {string} issuedAt
 * @property {string} [expiresAt]   Present on bundle payloads
 */

/**
 * @typedef {'suite' | 'bundle' | 'fixture'} EngagementSource
 */

/**
 * Engagement summary for the picker. Never carries field values.
 * @typedef {object} EngagementSummary
 * @property {string} id
 * @property {string} companyName
 * @property {string} stage
 */

/**
 * Result posted back to Suite.
 * @typedef {object} SuiteResult
 * @property {string} form
 * @property {string} srn
 * @property {string} status
 * @property {string} capturedAt
 * @property {number} fieldsWritten
 * @property {DiffMismatch[]} mismatches
 * @property {number} recipeVersion
 * @property {number} fieldMapVersion
 */

/* ------------------------------------------------------------------------ */
/* Bundle (.vcfoa)                                                           */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {object} BundleEnvelope
 * @property {'vcfoa'} format
 * @property {number} version
 * @property {{ issuedAt: string, expiresAt: string, form: string, engagementId: string }} manifest
 * @property {{ name: 'PBKDF2', salt: string, iterations: number, hash: 'SHA-256' }} kdf
 * @property {{ name: 'AES-GCM', iv: string }} cipher
 * @property {string} ciphertext   base64
 */

/* ------------------------------------------------------------------------ */
/* Run state                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {'idle' | 'running' | 'paused' | 'halted' | 'failed' | 'aborted'} RunStatus
 */

/**
 * @typedef {object} StepResult
 * @property {number} index
 * @property {StepOp} op
 * @property {string} label
 * @property {boolean} ok
 * @property {number} ms
 * @property {boolean} [skipped]    Skipped by the lead after a restart mid-step
 * @property {string} [error]       Error message; never a value
 */

/**
 * @typedef {object} DiffMismatch
 * @property {string} key
 * @property {string} label
 * @property {string} expected
 * @property {string} actual
 * @property {string} reason
 */

/**
 * @typedef {object} DiffSkip
 * @property {string} key
 * @property {string} reason
 */

/**
 * @typedef {object} Diff
 * @property {number} checked
 * @property {number} matched
 * @property {DiffMismatch[]} mismatches
 * @property {DiffSkip[]} skipped
 */

/**
 * Run log entry. Op, label, outcome, duration. Never a value.
 * @typedef {object} LogEntry
 * @property {string} at            ISO-8601
 * @property {string} op
 * @property {string} label
 * @property {'ok' | 'error' | 'skipped' | 'info'} outcome
 * @property {number} ms
 * @property {string} [note]
 */

/**
 * What the page looks like after a restart interrupted a step. Booleans and
 * counts only; never a value.
 * @typedef {object} InFlightEvidence
 * @property {string} url             Tab URL now ('' when unreadable)
 * @property {string | null} target   Selector inspected, when the step has one
 * @property {boolean | null} targetFound
 * @property {boolean | null} holdsExpected  fill/select/check: field already holds its value
 * @property {number | null} matched  fillGroup: fields holding their value
 * @property {number | null} total    fillGroup: fields with a value to fill
 * @property {string | null} note     Why evidence is incomplete, if it is
 */

/**
 * Why a run is paused.
 * @typedef {{ kind: 'humanGate', message: string }
 *   | { kind: 'inFlight', stepIndex: number, op: StepOp, label: string, message: string, evidence: InFlightEvidence }} PauseReason
 */

/**
 * @typedef {object} RunState
 * @property {string} runId
 * @property {string} formId
 * @property {string} recipeId
 * @property {number} recipeVersion
 * @property {string} fieldMapId
 * @property {number} fieldMapVersion
 * @property {string} engagementId
 * @property {number} tabId
 * @property {number} stepIndex      Next step to execute
 * @property {RunStatus} status
 * @property {string} startedAt
 * @property {string} [endedAt]
 * @property {{ index: number, op: StepOp, label: string, startedAt: string } | null} inFlight
 * @property {PauseReason | null} pause
 * @property {StepResult[]} stepResults
 * @property {{ index: number, op: StepOp, label: string }[]} steps  Labels for the panel list
 * @property {Diff | null} diff
 * @property {AssistError | null} error
 * @property {LogEntry[]} log
 * @property {boolean} abortRequested
 * @property {boolean} mismatchOverride  Lead explicitly accepted mismatches
 * @property {boolean} submittedByHuman  Lead pressed "I have submitted"
 * @property {number} fieldsWritten
 * @property {string} [haltReason]
 */

/* ------------------------------------------------------------------------ */
/* Panel-facing shapes                                                       */
/* ------------------------------------------------------------------------ */

/**
 * One row of the panel 2 verify table. Carries the value; shown only there.
 * @typedef {object} VerifyRow
 * @property {string} key
 * @property {string} label
 * @property {string} sourceField
 * @property {string} section
 * @property {string | null} value    Transformed value, or null when missing
 * @property {boolean} hasValue
 * @property {boolean} optional
 * @property {Stability} stability
 * @property {EntryMode} entryMode
 * @property {number | null} maxLength
 * @property {string | null} warning  e.g. exceeds maxLength
 */

/**
 * Prepared-form record kept in session storage between panel 2 and the run.
 * @typedef {object} Prepared
 * @property {string} formId
 * @property {string} recipeId
 * @property {number} recipeVersion
 * @property {string} recipeLabel
 * @property {string} fieldMapId
 * @property {number} fieldMapVersion
 * @property {string} engagementId
 * @property {string[]} fragileKeys
 * @property {string[]} warnings      Non-blocking, e.g. Suite version skew
 * @property {number} fillableCount
 * @property {{ index: number, op: StepOp, label: string }[]} steps
 */

/**
 * Captured result awaiting post.
 * @typedef {object} CapturedResult
 * @property {string} engagementId
 * @property {SuiteResult} result
 * @property {boolean} posted
 * @property {string} [postedAt]
 */

/**
 * Everything the panel needs to render, returned by GET_STATE.
 * @typedef {object} PanelSnapshot
 * @property {string} version
 * @property {string} suiteOrigin
 * @property {boolean} devMode
 * @property {boolean} unpacked
 * @property {EngagementSource | null} engagementSource
 * @property {SuiteEngagement | null} engagement
 * @property {string | null} lastForm
 * @property {Prepared | null} prepared
 * @property {VerifyRow[] | null} verifyRows
 * @property {RunState | null} run
 * @property {CapturedResult | null} captured
 * @property {{ id: string, label: string, enabled: boolean }[]} forms
 */

/* ------------------------------------------------------------------------ */
/* Messages: panel <-> worker                                                */
/* ------------------------------------------------------------------------ */

/**
 * @typedef {{ type: 'va.getState' }
 *   | { type: 'va.setSuiteOrigin', origin: string }
 *   | { type: 'va.setDevMode', devMode: boolean }
 *   | { type: 'va.listEngagements', formId: string }
 *   | { type: 'va.loadEngagement', source: 'suite' | 'fixture', formId: string, engagementId?: string }
 *   | { type: 'va.loadEngagement', source: 'bundle', formId: string, envelope: unknown, passphrase: string }
 *   | { type: 'va.prepareForm', formId: string }
 *   | { type: 'va.startRun', tabId: number }
 *   | { type: 'va.continueGate' }
 *   | { type: 'va.resolveInFlight', action: 'continue' | 'retry' }
 *   | { type: 'va.abortRun' }
 *   | { type: 'va.overrideMismatches', confirmed: boolean }
 *   | { type: 'va.markSubmitted' }
 *   | { type: 'va.captureResult', tabId: number }
 *   | { type: 'va.postResult' }
 *   | { type: 'va.reset' }} PanelRequest
 */

/**
 * Every panel request is answered with a Result whose value depends on the
 * request. The panel then re-reads the snapshot.
 * @typedef {import('./result.js').Result<unknown>} PanelResponse
 */

/* ------------------------------------------------------------------------ */
/* Messages: worker <-> content script                                       */
/* ------------------------------------------------------------------------ */

/**
 * Ops the content script executes. All site knowledge arrives in `args`.
 * @typedef {'ping' | 'exists' | 'inspect' | 'click' | 'setValue' | 'readBack'
 *   | 'pickWidget' | 'check' | 'waitFor' | 'waitForGone' | 'waitForUrl'
 *   | 'settle' | 'readText' | 'describePage'} ContentOp
 */

/**
 * Attributes of an element, used by the guard. Text is truncated to 80
 * characters; `value` is included only for buttons and inputs of button type,
 * so no field value ever leaves the page inside a descriptor.
 * @typedef {object} ElementDescriptor
 * @property {string} tag
 * @property {string} type
 * @property {string} id
 * @property {string} name
 * @property {string} text
 * @property {string} value
 * @property {string} ariaLabel
 * @property {string} role
 * @property {string} autocomplete
 * @property {string} placeholder
 */

/**
 * Pattern set passed to the content script so it re-checks the same rules the
 * worker applied. Shape mirrors constants.DANGER / constants.CREDENTIAL.
 * @typedef {{ pattern: string, flags: string, types: readonly string[] }} PatternSet
 */

/**
 * @typedef {object} ContentRequest
 * @property {'va.op'} type
 * @property {string} runId
 * @property {ContentOp} op
 * @property {Record<string, unknown>} args
 */

/**
 * @typedef {{ ok: true, value: unknown } | { ok: false, error: AssistError }} ContentResponse
 */

/* ------------------------------------------------------------------------ */
/* Content-script globals (window.__VA)                                      */
/* ------------------------------------------------------------------------ */

/**
 * Outcome of selector resolution.
 * @typedef {{ ok: true, element: Element, selector: string }
 *   | { ok: false, error: AssistError }} ResolveResult
 */

/**
 * @typedef {object} ResolveApi
 * @property {(selectors: Selectors, field?: string) => ResolveResult} resolve
 * @property {(selector: string, shadowPath?: string[]) => Element[]} queryAll
 * @property {(el: Element) => boolean} isVisible
 * @property {(el: Element) => ElementDescriptor} describe
 * @property {(selectors: Selectors) => number[]} countAll
 */

/**
 * @typedef {object} ObserveApi
 * @property {(selectors: Selectors, timeoutMs: number) => Promise<boolean>} waitFor
 * @property {(selector: string, timeoutMs: number) => Promise<boolean>} waitForGone
 * @property {(pattern: string, timeoutMs: number) => Promise<{ matched: boolean, url: string }>} waitForUrl
 * @property {(quietMs: number, maxMs: number) => Promise<boolean>} settle
 * @property {(ms: number) => Promise<void>} sleep
 */

/**
 * @typedef {object} SetValueApi
 * @property {(el: Element, value: string, type: FieldType) => { ok: true, marker: string } | { ok: false, error: AssistError }} setNative
 * @property {(el: Element, type: FieldType) => { actual: string, alt: string }} readBack
 * @property {(el: Element, value: string, entry: FieldEntry, timeoutMs: number) => Promise<{ ok: true, actual: string } | { ok: false, error: AssistError }>} pickWidget
 * @property {(el: Element, checked: boolean) => { ok: true, actual: string } | { ok: false, error: AssistError }} setChecked
 * @property {(el: Element, mode: 'text' | 'value' | 'attribute', attribute?: string) => string} readText
 * @property {(el: Element) => void} click
 * @property {(el: Element) => string} mark
 */

/**
 * @typedef {object} VAGlobal
 * @property {ResolveApi} [resolve]
 * @property {ObserveApi} [observe]
 * @property {SetValueApi} [setvalue]
 * @property {boolean} [bridgeInstalled]
 */

export {};
