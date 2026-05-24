/**
 * makeDialogs — wraps SillyTavern's callGenericPopup into confirm/prompt/alert helpers.
 *
 * @param {Function} callGenericPopup - ST's callGenericPopup function
 * @param {object}   POPUP_TYPE       - ST's POPUP_TYPE enum
 * @returns {{ confirm: Function, prompt: Function, alert: Function }}
 */
export function makeDialogs(callGenericPopup, POPUP_TYPE) {
  return {
    /**
     * Show a yes/no confirmation dialog.
     * @param {string} message
     * @param {string} [title]
     * @returns {Promise<boolean>}
     */
    async confirm(message, title = 'Confirm') {
      const result = await callGenericPopup(message, POPUP_TYPE.CONFIRM, '', { okButton: 'OK', cancelButton: 'Cancel' });
      return result === 1 || result === true;
    },

    /**
     * Show a text-input prompt dialog.
     * Returns null when the user cancels; returns the string (possibly empty) when confirmed.
     * @param {string} message
     * @param {string} [defaultValue]
     * @returns {Promise<string|null>}
     */
    async prompt(message, defaultValue = '') {
      const result = await callGenericPopup(message, POPUP_TYPE.INPUT, defaultValue ?? '', { rows: 1 });
      if (result === null || result === false || result === undefined) return null;
      return String(result);
    },

    /**
     * Show an informational alert dialog.
     * @param {string} message
     * @returns {Promise<void>}
     */
    async alert(message) {
      await callGenericPopup(message, POPUP_TYPE.TEXT, '', { okButton: 'OK' });
    },
  };
}
