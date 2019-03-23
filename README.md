# movearguments

This extension adds actions to vscode to move arguments.

## Features

Adds the action movearguments.action.moveLeft and movearguments.action.moveRight. These actions move the selected argument in list. Commas are used to separate the arguments and lists may be enclosed in (...), [...] or {...}.

* selects the moved argument after moving
* preserves the selection direction
* works with multiple selections (order of the selected arguments will not be changed)
* preserves starting and ending whitespaces from the new position
* does not move arguments out of lists or puts them inside lists
* BUT if the list delimiter is selected arguments can be moved out and in

## Requirements

None.

## Release Notes

### 1.0.0

Initial release of MoveArguments. Does nothing else as what is mentioned in the features.

## Known Issues

* string literals are not respected
* arguments containing complete lists can only be moved when selecting the complete list beforehand