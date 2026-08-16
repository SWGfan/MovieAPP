@echo off
rem Keeps jenkinsmovies.duckdns.org pointed at this PC's current home IP.
rem Runs silently on a schedule (see Task Scheduler setup in the README).
curl -s "https://www.duckdns.org/update?domains=jenkinsmovies&token=761a7aa4-c531-49f2-b988-ed69b675dbf5&ip="
