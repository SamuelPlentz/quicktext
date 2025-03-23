[x] load content of template and script files from background via Experiment
[x] parse templates and script files from background
[x] swap in compose script code and make it use files loaded from background
[x] make settings window update/reparse templates 
[x] eliminate template setter
[x] replace and properly implement file picker
[x] replace most of utils.mjs and email-addresses.mjs with messengerUtilities API
[x] implement choice via popover
[x] migrate templates to local storage (keep XML files as backup) and decouple XUL
    settings dialog from Experiment usage as much as possible
[x] properly implement startup imports
[x] rename group to groups everywhere
[x] find a preliminary solution for scripts, looks like this will not work without breaking
    existing scripts :-( (they have to use WebExtension code)

[x] change composer toolbar Experiment to use templates from storage
[x] change composer toolbar Experiment to use notifytools to trigger actions
[x] implement toolbar reload on template change and time change
[x] replace compose action button by menu typed action button
[x] remove as much legacy Quicktext code as possible 
[ ] move composer toolbar Experiment into a separate add-on

[x] make template manager use files loaded from background
[ ] replace XUL template manager with HTML template manager
[ ] add gallery for attachments, images and text files, which are currently
    references via file system paths, which will not work as a pure webextension

[ ] keyword + special seems to eat the leading space