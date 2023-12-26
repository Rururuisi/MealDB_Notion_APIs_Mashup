Screencast Link: https://youtu.be/xB_QGDW_9u0


run command: `node index.js`

Make sure you selected the page you entered for the page url when you grant permission on Notion Authorization page. 

Since the token will be cached, the further requests will skip the authentication during current connection. You won't be able to do the authentication and select pages to grant permissions at this point.

If you selected pages other than this, either delete the token.json file manually then back to the root page redo again or press Ctrl+C to end the program (will automatically delete the token.json file for you) then restart the program.
