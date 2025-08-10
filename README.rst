ChatGPT Button Change Notifier
==============================

A minimal Chromium extension that runs on ``https://chatgpt.com/c/*``, finds the button:

.. code-block:: none

   //div[@data-testid='composer-trailing-actions']//button[@id='composer-submit-button' or @data-testid='composer-speech-button']

and shows a desktop notification *whenever that button changes*. The notification body is the button’s ``aria-label``.


How notifications are shown
---------------------------

The content script uses the Web Notifications API (no extra Chrome permissions needed). The first time it triggers, your browser may prompt to allow notifications for ``chatgpt.com``. Allow them to see notifications.


Build (ZIP for drag & drop)
---------------------------

.. code-block:: bash

   python scripts/bundle.py

This creates a ZIP under ``./dist/`` containing the extension files at the archive root (with ``manifest.json`` at the top level). You can drag & drop this ZIP into ``chrome://extensions`` (enable Developer mode) to load it.


Files
-----

- ``extension/manifest.json`` — MV3 manifest
- ``extension/content.js`` — content script that watches the button via XPath and posts a notification when it changes
- ``scripts/bundle.py`` — cross-platform Python bundler (creates a ZIP ready for drag & drop)
