const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[onclick]',
  '[contenteditable="true"]',
  'summary',
].join(',')

export function buildStateScript(maxElements) {
  return `(() => {
    const elements = collectInteractiveElements(${maxElements});
    return {
      success: true,
      url: location.href,
      title: document.title,
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      textPreview: normalizeText(document.body?.innerText || '').slice(0, 2400),
      elements
    };

    ${sharedBrowserUseHelpers()}

    function collectInteractiveElements(max) {
      return Array.from(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)}))
        .filter(isVisible)
        .slice(0, max)
        .map((element, index) => describeElement(element, index));
    }
  })()`
}

export function buildClickScript(index) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    element.click();
    return { success: true, index: ${index}, element: describeElement(element, ${index}), url: location.href };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildMouseActionScript(index, action) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    const action = ${JSON.stringify(action)};
    if (action === 'hover') {
      element.dispatchEvent(new MouseEvent('mouseover', eventInit));
      element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
      element.dispatchEvent(new MouseEvent('mousemove', eventInit));
    } else if (action === 'double_click') {
      element.focus?.();
      element.dispatchEvent(new MouseEvent('mousedown', eventInit));
      element.dispatchEvent(new MouseEvent('mouseup', eventInit));
      element.dispatchEvent(new MouseEvent('click', eventInit));
      element.dispatchEvent(new MouseEvent('mousedown', eventInit));
      element.dispatchEvent(new MouseEvent('mouseup', eventInit));
      element.dispatchEvent(new MouseEvent('click', eventInit));
      element.dispatchEvent(new MouseEvent('dblclick', eventInit));
    } else if (action === 'right_click') {
      element.focus?.();
      element.dispatchEvent(new MouseEvent('contextmenu', { ...eventInit, button: 2, buttons: 2 }));
    } else {
      return { success: false, error: 'Unsupported mouse action', action };
    }
    return { success: true, action, index: ${index}, element: describeElement(element, ${index}) };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildInputScript(index, text) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    const value = ${JSON.stringify(text)};
    if ('value' in element) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      return { success: false, error: 'Element is not input-like', index: ${index}, tag: element.tagName.toLowerCase() };
    }
    return { success: true, index: ${index}, value };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildMarkFileInputScript(index, markerId) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    if (element.tagName.toLowerCase() !== 'input' || String(element.type || '').toLowerCase() !== 'file') {
      return { success: false, error: 'Element is not a file input', index: ${index}, tag: element.tagName.toLowerCase(), type: element.type || '' };
    }
    const marker = ${JSON.stringify(markerId)};
    element.setAttribute('data-noema-browser-use-file-id', marker);
    return { success: true, index: ${index}, selector: '[data-noema-browser-use-file-id="' + marker + '"]' };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildTypeScript(text) {
  return `(() => {
    const element = document.activeElement;
    if (!element) return { success: false, error: 'No focused element' };
    const value = ${JSON.stringify(text)};
    if ('value' in element) {
      const start = element.selectionStart ?? String(element.value || '').length;
      const end = element.selectionEnd ?? start;
      const current = String(element.value || '');
      element.value = current.slice(0, start) + value + current.slice(end);
      const nextCursor = start + value.length;
      element.setSelectionRange?.(nextCursor, nextCursor);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, typed: value, tag: element.tagName.toLowerCase() };
    }
    if (element.isContentEditable) {
      document.execCommand('insertText', false, value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return { success: true, typed: value, tag: element.tagName.toLowerCase() };
    }
    return { success: false, error: 'Focused element is not text-editable', tag: element.tagName?.toLowerCase?.() || '' };
  })()`
}

export function buildSelectScript(index, value) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    if (element.tagName.toLowerCase() !== 'select') {
      return { success: false, error: 'Element is not a select', index: ${index}, tag: element.tagName.toLowerCase() };
    }
    const target = ${JSON.stringify(value)};
    const option = Array.from(element.options).find(item => item.value === target || item.textContent.trim() === target);
    if (!option) {
      return {
        success: false,
        error: 'Option not found',
        options: Array.from(element.options).map(item => ({ value: item.value, text: item.textContent.trim() })).slice(0, 100)
      };
    }
    element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, index: ${index}, value: option.value, text: option.textContent.trim() };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildDropdownOptionsScript(index) {
  return `(() => {
    const element = getInteractiveElement(${index});
    if (!element) return { success: false, error: 'Element index not found', index: ${index} };
    if (element.tagName.toLowerCase() !== 'select') {
      return { success: false, error: 'Element is not a select', index: ${index}, tag: element.tagName.toLowerCase() };
    }
    return {
      success: true,
      index: ${index},
      options: Array.from(element.options).map((item, optionIndex) => ({
        index: optionIndex,
        value: item.value,
        text: item.textContent.trim(),
        selected: item.selected
      }))
    };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildExtractScript(maxChars) {
  return `(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(isVisible)
      .slice(0, 120)
      .map(a => ({ text: normalizeText(a.innerText || a.textContent || '').slice(0, 140), href: a.href }));
    return {
      success: true,
      url: location.href,
      title: document.title,
      text: normalizeText(document.body?.innerText || '').slice(0, ${maxChars}),
      links
    };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildGetScript(kind, index, selector, maxChars) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const selector = ${JSON.stringify(selector || '')};
    const index = ${Number(index ?? -1)};
    const element = selector
      ? document.querySelector(selector)
      : index >= 0
        ? getInteractiveElement(index)
        : document.documentElement;
    if (!element) {
      return { success: false, error: 'Target element not found', kind, index, selector };
    }
    if (kind === 'title') return { success: true, title: document.title, url: location.href };
    if (kind === 'html') return { success: true, html: String(element.outerHTML || '').slice(0, ${maxChars}) };
    if (kind === 'text') return { success: true, text: normalizeText(element.innerText || element.textContent || '').slice(0, ${maxChars}) };
    if (kind === 'value') return { success: true, value: 'value' in element ? String(element.value || '') : '' };
    if (kind === 'attributes') {
      return { success: true, attributes: Object.fromEntries(Array.from(element.attributes || []).map(attr => [attr.name, attr.value])) };
    }
    if (kind === 'bbox') {
      const rect = element.getBoundingClientRect();
      return { success: true, bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
    }
    return { success: false, error: 'Unsupported get kind', kind };

    ${sharedBrowserUseHelpers()}
  })()`
}

export function buildEvalScript(code) {
  return `Promise.resolve().then(() => {
    const result = (() => { ${String(code)} })();
    return result;
  })`
}

export function buildWaitConditionScript(mode, value) {
  if (mode === 'text') {
    return `normalizeText(document.body?.innerText || '').includes(${JSON.stringify(value)})`
  }
  return `Boolean(document.querySelector(${JSON.stringify(value)}))`
}

export function buildFindTextScript(text) {
  return `(() => {
    const needle = ${JSON.stringify(text)};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.textContent.includes(needle)) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      parent.scrollIntoView({ block: 'center', inline: 'center' });
      return { success: true, text: needle, element: describeElement(parent, -1) };
    }
    return { success: false, error: 'Text not found', text: needle };

    ${sharedBrowserUseHelpers()}
  })()`
}

function sharedBrowserUseHelpers() {
  return `
    function getInteractiveElement(index) {
      return Array.from(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})).filter(isVisible)[index];
    }

    function describeElement(element, index) {
      const rect = element.getBoundingClientRect();
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        type: element.getAttribute('type') || '',
        text: getElementText(element),
        value: getElementValue(element),
        href: element.href || '',
        placeholder: element.getAttribute('placeholder') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    }

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0;
    }

    function getElementText(element) {
      const text = element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '';
      return normalizeText(text).slice(0, 180);
    }

    function getElementValue(element) {
      if ('value' in element) return String(element.value || '').slice(0, 180);
      return '';
    }

    function normalizeText(text) {
      return String(text).replace(/\\s+/g, ' ').trim();
    }
  `
}
