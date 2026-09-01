@echo off
REM Double-click this file to open the project's idea graph in a browser.
REM Edit there, hit submit, and the change is written straight back into the
REM graph under ideas/ -- no file to move, no command to remember.
REM
REM ASCII ONLY IN THIS FILE. cmd.exe reads .cmd in the system OEM code page,
REM not UTF-8, so one non-ASCII character corrupts the line it sits on and the
REM rest of that line gets executed as a command. That is not theoretical: the
REM first version of this file had Chinese comments and cmd tried to run them.
REM A test asserts this file stays ASCII.
REM
REM The cd is not optional either: Explorer promises no particular working
REM directory when you double-click, so without it every relative path below is
REM wrong -- and that failure only ever shows up on somebody else's machine.
cd /d "%~dp0"
npx tsx claude-companion/ideas.ts serve %*
REM Keep the window open after the server stops, so the last line stays readable.
pause
