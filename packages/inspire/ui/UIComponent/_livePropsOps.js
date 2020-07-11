// @flow

import React from "react";

import { Kuery } from "~/raem/VALK";

import UIComponent, { isUIComponentElement } from "./UIComponent";

import { arrayFromAny, isPromise, wrapError } from "~/tools";

export const LivePropsPropsTag = Symbol("LiveProps.props");

export function wrapElementInLiveProps (component: UIComponent, element: Object, focus: any,
    hierarchyKey?: string) {
  const ret = tryWrapElementInLiveProps(component, element, focus, hierarchyKey);
  return (ret !== undefined) ? ret : element;
}

let _LiveProps;

/**
 * If no hierarchyKey is provided then it means the component doesn't
 * necessarily need one.
 *
 * @export
 * @param {UIComponent} component
 * @param {Object} element
 * @param {string} [name]
 * @returns
 */
export function tryWrapElementInLiveProps (
    component: UIComponent, element: Object, focus: any, hierarchyKey?: string) {
  // TODO(iridian, 2020-06): This whole setup should be implemented in
  // JSXDecoder also, then deprecated here, and finally removed from
  // here.
  const LiveProps = _LiveProps || (_LiveProps = require("./LiveProps").default);

  if ((element.type === LiveProps)
      || LiveProps.isPrototypeOf(element.type)) return undefined;
  let livePropsArgs = element[LivePropsPropsTag];
  try {
    if (livePropsArgs === undefined) {
      let extendedProps;
      if (element.key) (extendedProps = []).push(["key", element.key]);
      if (element.ref) (extendedProps || (extendedProps = [])).push(["$on.ref", element.ref]);
      livePropsArgs = tryCreateLivePropsArgs(
          element.type, extendedProps || Object.entries(element.props), hierarchyKey);
    }
    if (livePropsArgs) {
      // console.log("tryWrapElementInLiveProps LiveWrapper for", elementType.name, wrapperProps);
      /* Only enable this section for debugging React key warnings; it
      will break react elsewhere
      const DebugLiveProps = class DebugLiveProps extends LiveProps {};
      Object.defineProperty(DebugLiveProps, "name", {
        value: `LiveProps_${livePropsProps.key}`,
      });
      // */
      return React.createElement(...livePropsArgs, ...arrayFromAny(element.props.children));
    }
    return tryPostRenderElement(component, element, focus, hierarchyKey);
    // Element has no live props.
    // let parentUIContext;
  } catch (error) {
    throw wrapError(error, `During ${component.debugId()}\n .tryWrapElementInLiveProps(`,
            typeof element.type === "function" ? element.type.name : element.type, `), with:`,
        "\n\telement.props:", element.props,
        "\n\telement.props.children:", element.props && element.props.children,
    );
  }
}

export function postRenderElement (component, element, focus, hierarchyKey) {
  const ret = tryPostRenderElement(component, element, focus, hierarchyKey);
  return (ret !== undefined) ? ret : element;
}

export function tryPostRenderElement (component, element, focus, hierarchyKey) {
  let processedProps;
  if (isUIComponentElement(element)) {
    // const hasUIContext = props.parentUIContext;
    // If an UIComponent element isn't provided a parentUIContext
    // explicitly then the current component context is provided as
    // the parentUIContext.
    // if (!hasUIContext) parentUIContext = component.getUIContext();
    // Otherwise if the UIComponent has a key no pre-processing
    // is required now. UIComponent does its own post-processing.
    // else
    if (element.key || !element.hierarchyKey) return undefined;
    processedProps = { ...element.props, key: hierarchyKey };
  } else {
    // non-UIComponent sans live props has its children directly rendered.
    const children = component.tryRenderLensSequence(element.props.children, focus, hierarchyKey);
    if (children === undefined) {
      if (element.key || !hierarchyKey) return undefined;
      processedProps = { ...element.props, key: hierarchyKey };
    } else if (isPromise(children)) {
      children.operationInfo = Object.assign(children.operationInfo || {}, {
        slotName: "pendingChildrenLens", focus: element.props.children,
        onError: { slotName: "failedChildrenLens", children: element.props.children },
      });
      return children;
    } else {
      processedProps = { ...element.props, key: element.key || hierarchyKey, children };
    }
  }
  if (element.ref) processedProps.ref = element.ref;
  return React.createElement(element.type, processedProps);
  // ...(children || arrayFromAny(props.children)));
}

const _genericLivePropsBehaviors = {
  children: false, // ignore
  ref: "$on:ref",
  valoscope: true, // always trigger liveprops handling
  array: UIComponent,
};

export function tryCreateLivePropsArgs (elementType, propsSeq, hierarchyKey) {
  const LiveProps = _LiveProps || (_LiveProps = require("./LiveProps").default);

  const propsKueries = { currentIndex: 0 };
  // TODO(iridian, 2020-06): Fix this ridiculously useless deduplication
  // idea (of my own). Both coders themselves as well as the live kuery
  // system itself will deduplicate any live props there might be.
  const kueryDeduper = new Map();
  let kueryProps;
  const livePropsBehaviors = elementType.livePropsBehaviors || _genericLivePropsBehaviors;
  try {
    for (const [propName, propValue] of propsSeq) {
      let actualName = propName;
      const behavior = livePropsBehaviors[propName];
      if (behavior !== undefined) {
        if (typeof behavior === "boolean") {
          if (behavior === false) continue;
        } else if (typeof behavior === "string") {
          actualName = behavior;
        } else if (behavior === UIComponent) {
          if (!elementType.isUIComponent) continue;
        }
        kueryProps = {};
      }
      const newProp = _postProcessProp(propValue, propsKueries, actualName, kueryDeduper);
      if (newProp !== undefined) {
        (kueryProps || (kueryProps = {}))[actualName] = newProp;
      }
    }
    if (!kueryProps) return undefined;
    const livePropsProps = { elementType, elementPropsSeq: [...Object.entries(kueryProps)] };
    for (const [propName, propValue] of propsSeq) {
      if (kueryProps[propName] === undefined) {
        livePropsProps.elementPropsSeq.push([propName, propValue]);
      }
    }
    if (propsKueries.currentIndex) {
      delete propsKueries.currentIndex;
      livePropsProps.propsKueriesSeq = [...Object.entries(propsKueries)];
    }
    livePropsProps.hierarchyKey = hierarchyKey;
    return [LiveProps, livePropsProps];
  } catch (error) {
    throw wrapError(error, `During _createLivePropsProps(`,
            typeof elementType === "function" ? elementType.name : elementType, `), with:`,
        "\n\telement.props:", propsSeq,
    );
  }
}

/**
 * Converts all VALK kuery objects in properties into kuery placeholder
 * callback functions and adds the kueries as entries to the new
 * propsKueries prop.
 * The kuery placeholder callback takes a kueryValues object which is
 * a map from kueryId to a value and returns from it the value
 * corresponding to the kuery.
 *
 * @param {*} prop
 * @param {Object} propsKueries
 * @param {Object} name
 * @param {Object} kueryDeduper
 * @returns
 *
 * @memberof UIComponent
 */
function _postProcessProp (prop: any, propsKueries: Object, name: string, kueryDeduper: Object,
    parentFetchedKueryNames: ?Array) {
  if ((typeof prop !== "object") || (prop === null)) return undefined;
  if (prop instanceof Kuery) {
    let ret = kueryDeduper.get(prop.kueryId());
    if (!ret) {
      const kueryName = `props.${name}#${propsKueries.currentIndex++}`;
      propsKueries[kueryName] = prop;
      ret = _createFetchKueryProp(kueryName);
      ret.fetchedKueryNames = [kueryName];
      if (parentFetchedKueryNames) parentFetchedKueryNames.push(kueryName);
      kueryDeduper.set(prop.kueryId(), ret);
    }
    return ret;
  }
  if (!Array.isArray(prop)
      && ((Object.getPrototypeOf(prop) !== Object.prototype) || React.isValidElement(prop))) {
    // Only recurse plain arrays and objects.
    return undefined;
  }
  let modifications: any;
  const fetchedKueryNames = parentFetchedKueryNames || [];
  for (const key of Object.keys(prop)) {
    const postProcessedValue = _postProcessProp(
        prop[key], propsKueries, name, kueryDeduper, fetchedKueryNames);
    if (postProcessedValue !== undefined) {
      (modifications || (modifications = new Map())).set(key, postProcessedValue);
    }
  }
  if (!modifications) return undefined;
  const ret = (kueryValues: Object) => {
    const innerRet = Array.isArray(prop) ? [...prop] : { ...prop };
    modifications.forEach((value: any, key: any) => { innerRet[key] = value(kueryValues); });
    return innerRet;
  };
  ret.fetchedKueryNames = fetchedKueryNames;
  return ret;
}

function _createFetchKueryProp (kueryName: string) {
  return function _fetchKueryProp (kueryValues: Object) {
    try {
      return kueryValues[kueryName];
    } catch (error) {
      throw wrapError(error, `During _fetchKueryProp(${kueryName})`);
    }
  };
}
