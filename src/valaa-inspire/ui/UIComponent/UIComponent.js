// @flow

import React from "react";
import PropTypes from "prop-types";

import { VrapperSubscriber, FieldUpdate } from "~/valaa-engine/Vrapper";
import debugId from "~/valaa-engine/debugId";
import { Kuery, dumpKuery, dumpObject } from "~/valaa-engine/VALEK";

import Presentable from "~/valaa-inspire/ui/Presentable";

import { arrayFromAny, invariantify, outputError, wrapError }
    from "~/valaa-tools";

import { clearScopeValue, getScopeValue, setScopeValue } from "./scopeValue";
import { presentationExpander } from "./presentationHelpers";

import {
  _enableError, _toggleError, _clearError, _renderError,
} from "./_errorOps";
import {
  _componentWillMount, _componentWillReceiveProps, _shouldComponentUpdate, _componentWillUnmount,
} from "./_lifetimeOps";
import {
  _childProps, _checkForInfiniteRenderRecursion,
} from "./_propsOps";
import {
  _render, _renderFocus, _renderFocusAsSequence, _tryRenderLens, _tryRenderLensRole,
  _tryRenderLensArray
} from "./_renderOps";
import {
  _getVSSClasses,
} from "./_styleOps";
import {
  _finalizeDetachSubscribers, _attachSubscriber, _detachSubscriber, _attachKuerySubscriber
} from "./_subscriberOps";

export function isUIComponentElement (element: any) {
  return (typeof element.type === "function") && element.type.isUIComponent;
}

@Presentable(require("./presentation").default, "UIComponent")
export default class UIComponent extends React.Component {
  static _defaultPresentation = () => ({ root: {} });

  static isUIComponent = true;

  static contextTypes = {
    css: PropTypes.func,
    getVSSSheet: PropTypes.func,
    releaseVssSheets: PropTypes.func,
    engine: PropTypes.object,
    disabledLens: PropTypes.any,
    loadingLens: PropTypes.any,
    pendingLens: PropTypes.any,
  }

  static propTypes = {
    children: PropTypes.any, // children can also be a singular element.
    style: PropTypes.object,
    // If no uiContext nor parentUIContext the component is disabled. Only one of these two can be
    // given at the same time: if uiContext is given uiContext.focus is used directly,
    // otherwise parentUIContext.focus is taken as the focus and kuery is live-tracked against it.
    // If kuery is not given, parentUIContext.focus is used directly.
    uiContext: PropTypes.object,
    parentUIContext: PropTypes.object,
    focus: PropTypes.any,
    kuery: PropTypes.instanceOf(Kuery),
    head: PropTypes.any, // obsolete alias for focus.
    locals: PropTypes.object,
    context: PropTypes.object,
    overrideLens: PropTypes.arrayOf(PropTypes.any),
    disabledLens: PropTypes.any,
    loadingLens: PropTypes.any,
    pendingLens: PropTypes.any,
  }
  static noPostProcess = {
    children: true,
    kuery: true,
  }


  static propsCompareModesOnComponentUpdate = {
    _presentation: "ignore",
    uiContext: "shallow",
    parentUIContext: "shallow",
    focus: "shallow",
    head: "shallow",
    locals: "shallow",
    context: "shallow",
  }

  static stateCompareModesOnComponentUpdate = {}

  constructor (props: any, context: any) {
    super(props, context);
    invariantify(!(props.uiContext && props.parentUIContext),
        `only either ${this.constructor.name
            }.props.uiContext or ...parentUIContext can be defined at the same time`);
    invariantify(this.constructor.contextTypes.css,
        `${this.constructor.name}.contextTypes is missing css, ${
        ""}: did you forget to inherit super contextTypes somewhere? ${
        ""} (like: static ContextTypes = { ...Super.contextTypes, ...)`);
    this.state = { error: undefined, errorHidden: false };
    this._attachedSubscribers = {};
  }

  state: Object;
  _activeParentFocus: ?any;

  // React section: if overriding remember to super() call these base implementations

  componentWillMount () {
    try {
      _componentWillMount(this);
    } catch (error) {
      const finalError = wrapError(error,
          `Exception caught in ${this.debugId()})\n .componentWillMount(), with:`,
          "\n\tuiContext:", this.state.uiContext,
          "\n\tstate:", this.state,
          "\n\tprops:", this.props,
      );
      outputError(finalError);
      this.enableError(finalError);
    }
    this._isMounted = true;
  }

  componentWillReceiveProps (nextProps: Object, nextContext: any,
      forceReattachListeners: ?boolean) {
    try {
      _componentWillReceiveProps(this, nextProps, nextContext, forceReattachListeners);
    } catch (error) {
      const finalError = wrapError(error,
          `Exception caught in ${this.debugId()})\n .componentWillReceiveProps(), with:`,
          "\n\tuiContext:", this.state.uiContext,
          "\n\tstate:", this.state,
          "\n\tprops:", this.props,
          "\n\tnextProps:", nextProps,
      );
      outputError(finalError);
      this.enableError(finalError);
    }
  }

  shouldComponentUpdate (nextProps: Object, nextState: Object, nextContext: Object): boolean {
    try {
      return _shouldComponentUpdate(this, nextProps, nextState, nextContext);
    } catch (error) {
      const finalError = wrapError(error,
          `Exception caught in ${this.debugId()})\n .shouldComponentUpdate(), with:`,
          "\n\tprops:", this.props,
          "\n\tnextProps:", nextProps,
          "\n\tstate:", this.state,
          "\n\tnextState:", nextState,
          "\n\tcontext:", this.context,
          "\n\tnextContext:", nextContext,
      );
      outputError(finalError);
      this.enableError(finalError);
    }
    return true;
  }

  componentWillUnmount () {
    try {
      _componentWillUnmount(this);
    } catch (error) {
      const finalError = wrapError(error,
          `Exception caught in ${this.debugId()})\n .componentWillUnmount(), with:`,
          "\n\tprops:", this.props,
          "\n\tstate:", this.state,
          "\n\tcontext:", this.context,
      );
      outputError(finalError);
    }
  }

  setState (newState: any, callback: any) {
    if (this._isMounted) super.setState(newState, callback);
    else {
      // Performance optimization: mutate state directly if not mounted or just mounting.
      // setState calls are queued and could result in costly re-renders when called from
      // componentWillMount, strangely enough.
      // TODO(iridian): I find this a bit surprising: I would expect React to precisely to do this
      // optimization itself in componentWillMount (ie. not calling re-render), so it might be
      // something else we're doing wrong with the codebase. But adding this here resulted in
      // cutting the render time fully in half.
      Object.assign(this.state,
          typeof newState === "function"
            ? newState(this.state, this.props)
            : newState);
      if (callback) callback();
    }
  }

  // Public API

  getValaa () { return this.context.engine.getRootScope().Valaa; }

  getStyle () {
    return Object.assign({},
        (this.constructor._defaultPresentation().root || {}).style || {},
        this.style || {},
        this.props.style || {});
  }

  /**
   * Called from VSX via `VSS` alias setup in src/inspire/ui/helper/lens.js.
   * Takes a property that should point to a media file, unthunks the content and then looks up
   * the style sheet from the ui context
   */
  getVssClasses = (styleMediaProperty: Object, extraContext: ?Object) => {
    try {
      return _getVSSClasses(this, styleMediaProperty, extraContext);
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .getVssClasses:`,
      "\n\tStyle media kuery:", [...dumpKuery(styleMediaProperty)],
      "\n\tcurrent props:", this.props,
      "\n\tstate:", this.state);
    }
  }

  static propsCompareModesOnComponentUpdate = {
    _presentation: "ignore",
    reactComponent: "ignore",
  }

  /**
   * Returns the current focus of this UI component or throws if this component is disabled.
   */
  getFocus (state: Object = this.state) {
    const ret = this.tryFocus(state);
    invariantify(typeof ret !== "undefined", `${this.constructor.name
        }.getFocus() called when component is disabled (focus/head is undefined)`);
    return ret;
  }

  tryFocus (state: Object = this.state) {
    const ret = getScopeValue(state.uiContext, "focus");
    return (typeof ret !== "undefined")
        ? ret
        : getScopeValue(state.uiContext, "head");
  }

  /**
   * Returns the current UI uiContext of this UI component or null if this component is disabled.
   */
  getUIContext () {
    return this.state.uiContext;
  }

  getUIContextValue (key: string | Symbol) {
    return getScopeValue(this.state.uiContext, key);
  }

  trySetUIContextValue (key: string | Symbol, value: any) {
    if (this.state.uiContext) this.setUIContextValue(key, value);
  }

  setUIContextValue (key: string | Symbol, value: any) {
    setScopeValue(this.state.uiContext, key, value);
  }

  tryClearUIContextValue (key: string | Symbol) {
    if (this.state.uiContext) this.clearUIContextValue(key);
  }

  clearUIContextValue (key: string | Symbol) {
    clearScopeValue(this.state.uiContext, key);
  }

  _attachedSubscribers: Object;
  style: Object;

  rawPresentation () {
    return this.props._presentation || this.constructor._defaultPresentation();
  }

  // Returns a fully expanded presentation map or entry at componentPath
  presentation (componentPath: any, { initial, extraContext = {}, baseContext }:
      { initial?: Object, extraContext?: Object, baseContext?: Object } = {}) {
    return presentationExpander(
        this,
        componentPath,
        initial || { key: `-${componentPath}>` },
        extraContext,
        baseContext || this.getUIContext());
  }

  /**
   * Returns comprehensive props for a child element. Fetches and expands the presentation using
   * given 'name', as per presentation, using scope as extra context
   *
   * Includes:
   * key (generated)
   * head ()
   * scope ()
   * kuery (null)
   *
   * @param {any} name
   * @param {any} { index, head, kuery }
   */
  childProps (name: string, options:
      { index?: any, kuery?: Kuery, head?: any, focus?: any, context?: Object } = {},
      initialProps: Object = this.presentation(name, { extraContext: options.context })) {
    try {
      return _childProps(this, name, options, initialProps);
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .childProps(${name}), with:`,
          "\n\toptions:", options,
          "\n\tkey:", options.context && options.context.key,
          "\n\tprops:", this.props,
          "\n\tstate:", this.state,
          "\n\trawPresentation:", this.rawPresentation());
    }
  }

  debugId (options: ?Object) {
    const keyString = this.getUIContext() && this.getUIContext().hasOwnProperty("key") // eslint-disable-line
            ? `key: '${this.getUIContext().key}'`
        : (this.props.context && this.props.context.key)
            ? `key: '${this.props.context.key}'`
        : "no key";
    let focus = this.getUIContextValue("focus");
    if (typeof focus === "undefined") focus = this.getUIContextValue("head");
    return `${this.constructor.name}(${keyString}, focus: ${
        Array.isArray(focus)
            ? `[${focus.map(entry => debugId(entry, options)).join(", ")}]`
            : debugId(focus, options)
    })`;
  }


  /**
   * Attach a given subscriber with a particular given subscriberKey to this UIComponent.
   * A possible already existing subscriber with the same subscriberKey is detached.
   * All subscribers are detached when the component is destroyed or if the focus of this component
   * changes.
   *
   * Guide to consistent naming of subscriberKey:
   *
   * Basic fields: `${componentName}.${fieldNameOnHead}.${_subscribedFieldName}`
   *   example: "EditorNode.editTarget.name"
   *     starts from this.getFocus(), goes to focus.get("editTarget"), subscribes for "name" on it
   *
   * Properties: `${componentName}['${propertyName}']`
   *   example: "DialogueEditor['editTarget']
   *     subscribes implicitly field 'Property.value' if no followup
   *   example: "DialogueEditor['editTarget'].name"
   *     treats Property.value as Identifier and subscribes to 'name' of the Identifier.reference
   *
   * Kuery or complex subscribers: `${componentName}.(${ruleName})`
   *   example: "Field.(toShown)"
   *     subscribes to a complex rule or kuery called toShown of Field focus
   *
   * Others:
   *   example "PropertiesPanel.*"
   *     subscribes to all fields of PropertiesPanel focus
   *   example `EditorNode.relation#${vAddedRleation.rawId}.*`
   *     subscribes to all fields on a particularily identified relation
   *
   * @param {string} subscriberKey
   * @param {VrapperSubscriber} subscriber
   * @returns {VrapperSubscriber}
   */
  attachSubscriber (subscriberKey: string, subscriber: VrapperSubscriber): VrapperSubscriber {
    return _attachSubscriber(this, subscriberKey, subscriber);
  }

  attachKuerySubscriber (subscriberName: string, head: any, kuery: any, options: {
    onUpdate: (update: FieldUpdate) => void, noImmediateRun?: boolean, // ...rest are VALKOptions
  }) {
    try {
      return _attachKuerySubscriber(this, subscriberName, head, kuery, options);
    } catch (error) {
      throw wrapError(error, `during ${this.debugId()}\n .attachKuerySubscriber(${
              subscriberName}), with:`,
          "\n\thead:", ...dumpObject(head),
          "\n\tkuery:", ...dumpKuery(kuery),
          "\n\toptions:", ...dumpObject(options),
      );
    }
  }

  detachSubscriber (subscriberKey: string, options: { require?: boolean } = {}) {
    return _detachSubscriber(this, subscriberKey, options);
  }

  // Overridable callbacks. Remember to call base class implementations with super.

  /**
   * Override to update subscribers whenever the focus has changed.
   * If the focus is undefined disables this component.
   * Initiated from "componentWillMount" and "componentWillReceiveProps".
   * When subscribers are registered to the UIComponent itself using using attachSubscriber
   * deregistration happens automatically for the previous foci and when "componentWillUnmount".
   */
  attachSubscribers (focus: any, props: Object) { // eslint-disable-line no-unused-vars
    this._areSubscribersAttached = true;
  }

  detachSubscribers (/* focus: ?Vrapper */) {
    return _finalizeDetachSubscribers(this);
  }

  _isMounted: boolean;
  _areSubscribersAttached: ?boolean;

  // Helpers

  _errorMessage: ?string;

  enableError = (error: string | Error) => _enableError(this, error)
  toggleError = () => _toggleError(this)
  clearError = () => _clearError(this)

  // defaults to lens itself
  renderLens (lens: any, lensName: string):
      null | string | React.Element<any> | [] | Promise<any> {
    const ret = this.tryRenderLens(lens, lensName);
    return (typeof ret !== "undefined") ? ret
        : lens;
  }

  tryRenderLens (lens: any, lensName: string):
      void | null | string | React.Element<any> | [] | Promise<any> {
    try {
      return _tryRenderLens(this, lens, lensName);
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .renderLens, with:`,
          "\n\tlensName:", lensName,
          "\n\tlens:", lens,
          "\n\ttypeof lens:", typeof lens);
    }
  }

  // defaults to arrayFromAny(sequence)
  renderLensSequence (sequence: any):
      [] | Promise<any[]> {
    const array = arrayFromAny(sequence !== null ? sequence : undefined);
    const ret = _tryRenderLensArray(this, array);
    return (typeof ret !== "undefined") ? ret
        : array;
  }

  tryRenderLensSequence (sequence: any):
      void | [] | Promise<any[]> {
    return _tryRenderLensArray(this, arrayFromAny(sequence));
  }

  renderFocus (focus: any):
      null | string | React.Element<any> | [] | Promise<any> {
    return _renderFocus(this, focus);
  }

  renderFocusAsSequence (foci: any[], EntryElement: Object = UIComponent, entryProps: Object = {},
      keyFromFocus: (focus: any, index: number) => string
  ): [] {
    return _renderFocusAsSequence(this, foci, EntryElement, entryProps, keyFromFocus);
  }

  // defaults to null
  renderLensRole (role: string | Symbol, rootRoleName?: string):
      null | string | React.Element<any> | [] | Promise<any> {
    const ret = this.tryRenderLensRole(role, rootRoleName);
    return (typeof ret !== "undefined") ? ret
        : null;
  }

  tryRenderLensRole (role: string | Symbol, rootRoleName?: string):
      void | null | string | React.Element<any> | [] | Promise<any> {
    const actualRootRoleName = rootRoleName || String(role);
    try {
      if (!rootRoleName) {
        this.trySetUIContextValue(this.getValaa().rootRoleName, actualRootRoleName);
      }
      const ret = _tryRenderLensRole(this, actualRootRoleName,
          (typeof role === "string") ? role : undefined,
          (typeof role === "symbol") ? role : undefined, false);
      if (!rootRoleName) {
        this.tryClearUIContextValue(this.getValaa().rootRoleName);
      }
      return ret;
    } catch (error) {
      throw wrapError(error, `During ${this.debugId()}\n .renderLensRole(${String(role)}), with:`,
          "\n\trootRoleName:", actualRootRoleName);
    }
  }

  static thirdPassErrorElement = <div>
      Error caught while rendering error, see console for more details
  </div>;

  render (): null | string | React.Element<any> | [] {
    let firstPassError;
    try {
      if (!this._errorMessage && !_checkForInfiniteRenderRecursion(this)) {
        return _render(this);
      }
    } catch (error) {
      firstPassError = error;
    }
    try {
      if (firstPassError) {
        const wrappedError = wrapError(firstPassError,
            `Exception caught in ${this.debugId()})\n .render(), with:`,
            "\n\tuiContext:", this.state.uiContext,
            "\n\tfocus:", this.tryFocus(),
            "\n\tstate:", this.state,
            "\n\tprops:", this.props,
        );
        outputError(wrappedError);
        this.enableError(wrappedError);
      }
      return _renderError(this, this._errorMessage || "");
    } catch (secondPassError) {
      // Exercise in defensive programming. We should never get here, really,, but there's nothing
      // more infurating and factually blocking for the user than react white screen of death.
      // Of all react hooks .render() is most vulnerable to these from user actions, so we fall back
      // to simpler error messages to deny exceptions from leaving while still trying to provide
      // useful feedback for diagnostics & debugging purposes.
      try {
        outputError(wrapError(secondPassError,
            `INTERNAL ERROR: Exception caught in ${this.constructor.name
                }.render() second pass,`,
            "\n\twhile rendering firstPassError:", firstPassError,
            "\n\t...or existing error status:", this._errorMessage,
            "\n\tin component:", this));
        return (<div>
            Exception caught while trying to render error:
            {String(secondPassError)}, see console for more details
        </div>);
      } catch (thirdPassError) {
        try {
          console.error("INTERNAL ERROR: Exception caught on render() third pass:", thirdPassError,
              "\n\twhile rendering secondPassError:", secondPassError,
              "\n\tfirstPassError:", firstPassError,
              "\n\texisting error:", this._errorMessage,
              "\n\tin component:", this);
          return UIComponent.thirdPassErrorElement;
        } catch (fourthPassError) {
          console.warn("INTERNAL ERROR: Exception caught on render() fourth pass:", fourthPassError,
              "\n\tGiving up. You get candy if you ever see this.");
        }
        return null;
      }
    }
  }
}
