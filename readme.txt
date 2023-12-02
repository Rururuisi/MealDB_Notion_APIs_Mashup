Screencast Link: https://youtu.be/xB_QGDW_9u0


There're 2 things you need to fill out before run the program

1. auth/credentials.json
	- client_id
	- client_secret 

2. workpages/keyword_page.json
	- page_id 


page_id is id of the notion page you want to work with, you can find the id from the end of the page url.

Make sure you selected this page when you grant permissions. 

Since the token will be cached, the further requests will skip the authentication during current connection. You won't be able to do the authentication and select pages to grant permissions at this point.

If you selected pages other than this, either delete the token.json file manually then back to the root page redo again or press Ctrl+C to end the program (will automatically delete the token.json file for you) then restart the program.
