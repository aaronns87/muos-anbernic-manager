// Wiki: what every section of the manager does, in plain words, with search and a table of contents.

import { $, esc, icon, section } from "./core.js";
import { DEVICES, screenText } from "./devices.js";

const path = (...steps) => steps.map((s) => `<b>${s}</b>`).join(" &rsaquo; ");
const SSH_ON = path("Configuration", "Web Services", "Secure Shell");
const SFTP_ON = path("Configuration", "Web Services", "SFTP + Filebrowser");

/** [id, icon, title, section it explains (or ""), one-line summary, [[heading, html], ...]] */
const ARTICLES = [
  ["start", "star", "Getting started", "", "What the manager is, how it reaches the handheld, and what is safe to click.", [
    ["What the manager does", `<p>The manager runs on this computer and looks after your Anbernic or TrimUI handheld running MustardOS: the games in your
      <code>Roms/</code> folder, their box art, apps and updates, save games, BIOS files, emulator choices and the handheld's own settings.
      Everything happens in this browser tab; keep the terminal window that started it open.</p>
      <p>The sidebar groups the sections: <b>Library</b> (Games, Play, Artwork) is about your games, <b>Handheld</b> (Apps, Device Settings, Themes,
      Emulation, Files) changes what is on the device, <b>Tools</b> (System Tools, SSH) prepares cards and opens a shell, and <b>Manager</b>
      (Settings, Wiki) is about the manager itself.</p>`],
    ["Installing and the setup wizard", `<p><code>./muos-anbernic-manager/installer.sh</code> on macOS and Linux, or <code>installer.cmd</code>
      on Windows, gets a computer ready: it checks Node.js and the manager's packages (offering to install Node.js with Homebrew or winget, and
      <code>libmtp</code> for USB on a Mac), creates the workspace folders <code>Roms/</code> (one folder per system), <code>apps/</code>,
      <code>os/</code>, <code>bios/</code>, <code>backups/</code> and <code>themes/</code> next to the manager or in a folder you name, and can start from a clean cache.
      Existing folders and files are left as they are; an old cache is kept as <code>.cache-backup-&hellip;</code>.</p>
      <p>It also offers an <b>app shortcut</b> with the manager's icon: in Applications on a Mac, the Start menu on Windows, or the app menu on
      Linux. The shortcut opens a terminal window that runs the manager and opens this page; closing the window stops the manager.
      ${path("Settings", "Transfers, startup and updates", "App shortcut")} adds it later, or again after moving the manager's folder.</p>
      <p>The first start with a clean cache opens the <b>setup wizard</b>: your handheld model, the folders, how to connect, and extras such as the
      game description download and the app shortcut. <b>Skip setup</b> closes it; ${path("Settings", "Game data", "Run setup")} opens it again.
      After that, the shortcut, <code>./muos-anbernic-manager/run.sh</code> or <code>run.cmd</code> on Windows starts the manager.</p>
      <p><b>Updates.</b> The version next to the clock turns into <b>Update</b> when GitHub has a newer one. <b>Update now</b> runs
      <code>git pull</code> in a copy installed with <code>git clone</code>, or downloads and swaps in the new files in a copy
      downloaded as a ZIP (the old files stay in <code>.update-old</code>), then restarts in the same tab.
      ${path("Settings", "Check for manager updates")} turns the check off.</p>
      <p><b>What's new.</b> Every version's changes are listed in <code>CHANGELOG.md</code> in the manager's folder; <b>What's new</b> in the
      update dialog opens it on GitHub. Changes listed under <b>Unreleased</b> are already on GitHub and arrive with the next version.</p>`],
    ["Three ways to connect", `<ul>
      <li><b>Card reader.</b> Take the TF2 games card (on one-slot models, the only card) out of the handheld and put it in this computer. Fastest for copying many games, and needed for System Tools.</li>
      <li><b>USB cable.</b> On the handheld set ${path("Configuration", "Advanced Settings", "USB Function")} to <b>MTP</b>, then plug it in.</li>
      <li><b>Wi-Fi.</b> Handheld and computer on the same network. Turn on ${SFTP_ON} for files, and ${SSH_ON} for everything that changes
        the handheld itself. The handheld's address is set under <b>Wi-Fi settings</b> in Overview; <b>Find on network</b> looks for it.</li>
    </ul>`],
    ["Supported handhelds", `<p>The manager works with every handheld MustardOS supports. What it shows follows the model: screen size for
      artwork and themes, which ports run, which settings exist, and whether there is a second card slot (TF2) or Wi-Fi.</p>
      <table class="wiki-table">
      <tr><th>Model</th><th>Screen</th><th>Sticks</th><th>Wi-Fi</th><th>Cards</th></tr>
      ${DEVICES.map((d) => `<tr><td>${esc(d.maker)} ${esc(d.name.replace(/^TrimUI /, ""))}</td><td>${d.inches}&Prime;, ${esc(screenText(d))}</td><td>${d.sticks}</td><td>${d.wifi ? "Yes" : "No"}</td><td>${d.slots === 2 ? "SD1 + TF2" : "One SD card"}</td></tr>`).join("")}
      </table>`],
    ["How the manager knows your model", `<ul>
      <li><b>USB cable:</b> the handheld introduces itself by its model name.</li>
      <li><b>Wi-Fi:</b> the manager reads the model from MustardOS (over SFTP, or SSH when that is on).</li>
      <li><b>Card reader:</b> a card cannot say which handheld it is from. SD1 often can, from its play time records; otherwise the manager
        asks once and remembers the answer for that card. <b>Change</b> next to <b>Handheld</b> in Overview asks again.</li>
      <li>With nothing connected, the model picker under the logo decides. While a handheld is connected it shows the reported model and cannot be changed.</li>
    </ul>`],
    ["Which connection each feature needs", `<table class="wiki-table">
      <tr><th>Feature</th><th>Works with</th></tr>
      <tr><td>Copy games, artwork and packages to the handheld, Files</td><td>Card reader, USB or Wi-Fi</td></tr>
      <tr><td>Play time, Recently played, Collections</td><td>USB or Wi-Fi (they live on SD1 inside the handheld)</td></tr>
      <tr><td>Install or uninstall apps, Device Settings, Themes, Ports, Saves, BIOS, Cores, RetroArch, Game Tuning, SSH</td><td>Wi-Fi with Secure Shell on</td></tr>
      <tr><td>Install MustardOS, set up or wipe a card</td><td>Card reader</td></tr>
      <tr><td>Library check, Updates, App market downloads, adding games and artwork to <code>Roms/</code></td><td>Nothing; works on this computer</td></tr>
    </table>`],
    ["What is safe", `<ul>
      <li>Deleting something on this computer moves it to the <b>Trash</b>, so you can put it back.</li>
      <li>Deleting something on the handheld or its card is <b>permanent</b>; there is no Trash there.</li>
      <li>Anything that changes the handheld or erases a card asks you first and says what will happen.</li>
    </ul>`],
    ["Keyboard shortcuts", `<ul>
      <li><kbd>1</kbd> to <kbd>9</kbd> jump to the first nine sections in the sidebar, top to bottom (Overview to Files); <kbd>0</kbd> opens the Wiki.</li>
      <li><kbd>?</kbd> opens help for the page you are on.</li>
      <li><kbd>[</kbd> folds the sidebar into a narrow icon bar and back.</li>
      <li>In Games: <kbd>/</kbd> jumps to the search box, <kbd>S</kbd> turns on picking games, and the arrow keys step through games in the big game view.</li>
    </ul>`],
  ]],
  ["overview", "grid", "Overview", "overview", "The home page: connection, storage and what needs attention.", [
    ["What you see", `<p>Whether the handheld is connected and how (card reader, USB or Wi-Fi), how much space is left, how many of your systems have
      games and artwork, systems without games, MustardOS images in your <code>os</code> folder, and apps that have updates.</p>`],
    ["Wi-Fi settings", `<p>Enter the handheld's address here (shown on the handheld under ${path("Configuration", "Wi-Fi Network")}). The address can change
      when the handheld reconnects; <b>Find on network</b> searches for it again.</p>`],
    ["Recent activity", `<p>The last things the manager did: games copied, files deleted or moved to the Trash, settings saved, apps installed, and
      anything that failed. <b>Show all</b> opens the full log with a search box and a filter for warnings and errors. The log is kept on this computer
      in the manager's cache folder and holds the last few thousand entries.</p>`],
  ]],
  ["games", "handheld", "Games", "games", "Your game library: find, add, copy to the handheld and remove games, plus ScummVM games and PortMaster ports.", [
    ["The library", `<p>Every game file in <code>Roms/&lt;SYSTEM&gt;/</code>, grouped by system, with box art and a description from the LaunchBox games
      database. The controls next to the search box switch between grid and list view, show <b>Empty systems</b> (folders with no games yet),
      expand or collapse every system, and make the cards bigger or smaller with the slider.</p>`],
    ["Finding games", `<p>Type in the search box to match titles, file names, regions such as <i>Japan</i>, or systems. The filters narrow the list by
      platform, genre and year. <b>Roms/ library</b> and <b>On TF2</b> switch between the games on this computer and the games on the handheld's card.</p>`],
    ["Picking several games", `<p>Press <b>Select</b> (or <kbd>S</kbd>), tick games, then choose what to do with all of them at once: copy them to the
      handheld, move them to the Trash, or delete them from the handheld's card.</p>`],
    ["Copying games to the handheld", `<p>Picked games, with their artwork, are copied into the handheld's <code>ROMS</code> folder over whichever connection is
      active. A card formatted as FAT32 cannot hold a single file over 4 GB; the manager warns you before it tries.</p>`],
    ["Transfers", `<p>The <b>Transfers</b> panel in the bottom-right corner shows every copy: the one running with its progress, speed, time left
      and current file, the ones waiting their turn, and the finished ones with how much was copied, how long it took and any files that failed.
      A copy of several games has <b>Show the files</b>: every game in it with its own progress while it copies, and afterwards its size,
      time and speed, or why it failed.
      Start more copies while one runs and they wait in line. Stop the running copy or take a waiting one out of the queue at any time.
      Click the panel's title to minimise it to a thin progress bar, or hide it and open it again from the top bar. The history is kept
      between restarts until you clear it. Over USB the handheld takes one copy at a time, so a new one can start when the current one finishes.</p>`],
    ["Adding new games", `<p><b>Add games</b> takes game files you drop on it, puts each in the right system folder, and looks up its description and box art.</p>`],
    ["ScummVM games", `<p>A ScummVM game is a folder of data files, not a single ROM. Drop the game's folder on <b>Add games</b> (or use
      <b>Choose a ScummVM game folder</b>): it becomes <code>Roms/SCUMMVM/&lt;Name&gt;.scummvm</code>, an empty file the handheld lists, plus the
      data in <code>Roms/SCUMMVM/.&lt;Name&gt;/</code>. The handheld's ScummVM detects which game it is on first start. Copying and deleting a ScummVM
      game always takes its data folder along; folders named <code>_&lt;Name&gt;</code> or <code>&lt;Name&gt;</code> work too.</p>
      <p><b>Free games</b> in the ScummVM system lists the freeware games from scummvm.org (Beneath a Steel Sky, Flight of the Amazon Queen,
      Lure of the Temptress, Drascula, Dreamweb and more) and downloads one straight into <code>Roms/SCUMMVM</code>. Copy it to the handheld like
      any other game. Saves stay on the handheld in MustardOS's save folder, not in the game folder.</p>`],
    ["Ports (PortMaster)", `<p>Ports are PC games rebuilt for handhelds. MustardOS installs them with its own <b>PortMaster</b> app, so the
      <b>Ports</b> system in Games shows what is installed on the handheld instead of files in <code>Roms/</code>. It needs the handheld over Wi-Fi
      with ${SSH_ON} on.</p>
      <ul>
        <li><b>Browse</b> (or <b>Ports</b> at the top) opens the PortMaster library with screenshots. <b>Runs on this handheld</b> hides the few ports
          PortMaster does not offer for your model; <b>Ready to run</b> keeps only ports that come with everything they need.</li>
        <li><b>Install</b> asks the handheld's PortMaster to download the port and any runtime it needs, so the handheld needs internet access. It runs
          in the background; the port then shows under <b>Ports</b> in the handheld's menu. Go back to the main menu on the handheld first.</li>
        <li>Ports marked <b>Needs game files</b> run a commercial or freeware game you supply. After installing, open the port and use
          <b>Add game files</b>: pick files or a folder from your own copy, and the manager copies them into the folder the port's instructions name.</li>
        <li><b>Remove</b> has PortMaster delete the port's folder, launch script and artwork, including game files you added. This is permanent.</li>
      </ul>
      <p>Ports land on TF2 when it is in (<code>/mnt/sdcard/ports</code>), otherwise on SD1. Files you put in <code>Roms/PORTS</code> on this computer
      are not copied.</p>`],
    ["One game in detail", `<p>Click a game to see its big artwork, year, genre, players and rating, with tags for its library check
      (Verified, Bad dump, Modified), a missing BIOS and other versions you have. Use the arrow keys to step through the games.</p>
      <p>With the handheld connected, cards at the top show whether the game is on it, the core it starts with, how long you have played
      it and its saves. If its folder has no system yet, the card offers a one-click fix, such as using Arcade for CPS3 games.</p>
      <p>The tabs hold the rest:</p>
      <ul><li><b>About</b>: the description and its source, a video from YouTube when the database has one, and <b>Write your own</b>.
      Your description is saved next to the game in <code>Roms/&lt;SYSTEM&gt;/Text/</code>.</li>
      <li><b>Details</b>: the database facts, the file (size, date, CRC32, path), the library check result, the BIOS files the system
      needs, and for arcade games the parent or clone set.</li>
      <li><b>Handheld</b>: the core and who set it, play time (total, launches, average session, first and last played, cores used),
      collections and save files. <b>Read again</b> refreshes it.</li>
      <li><b>Related</b>: other versions, the arcade family, the same series, more from the developer and more of the genre. Opening one
      adds a <b>Back</b> link.</li></ul>
      <p>Drop an image on the artwork, or use <b>Replace artwork</b>, to change the box art. <b>Show in Finder</b> (Explorer on Windows)
      opens the game's folder.</p>`],
    ["Deleting a game", `<p>From this computer it goes to the Trash, optionally with its artwork. From the handheld's card it is deleted for good.</p>`],
  ]],
  ["play", "clock", "Play", "play", "Play time, recently played games and collections on the handheld.", [
    ["Play time", `<p>MustardOS records how long and how often you play each game while activity tracking is on (it is by default). This tab reads that
      record from SD1 and shows the total time played, the number of games and launches, and a list you can sort by most played, last played,
      most launches or name. Box art comes from your <code>Roms/</code> library when the game is there too.</p>
      <p>MustardOS writes the record when you leave a game, so press <b>Refresh</b> after playing.</p>`],
    ["Recently played", `<p>The games you started last, newest first, from MustardOS's history.</p>`],
    ["Collections", `<p>Collections are the handheld's own playlists, shown under <b>Collections</b> in its main menu. Here you can make one, rename it,
      delete it, and add or remove games.</p>
      <ul>
        <li>Type in <b>Add games</b> to search your <code>Roms/</code> library. Only games that are already on the handheld are offered, because a collection
          only points at games; it does not copy them.</li>
        <li>Removing a game from a collection or deleting a collection never deletes the game itself.</li>
        <li>The handheld shows changes after you go back to its main menu.</li>
        <li>Over USB a collection is renamed by copying its entries to a new folder, because USB cannot rename.</li>
      </ul>`],
  ]],
  ["artwork", "image", "Artwork", "artwork", "Box art for your games, on this computer and on the handheld.", [
    ["What artwork is", `<p>The pictures MustardOS shows next to each game in its menus. On this computer they live in <code>Roms/&lt;SYSTEM&gt;/Imgs/</code>,
      named like the game file. On the handheld they live in MustardOS's catalogue folder.</p>`],
    ["The four tabs", `<ul>
      <li><b>Sync</b> compares both sides and copies missing artwork either way.</li>
      <li><b>Roms/ library</b> shows, per system, how many games have artwork and which are missing it.</li>
      <li><b>On device</b> shows the artwork already on the handheld.</li>
      <li><b>Scrape</b> downloads missing box art automatically from online game databases.</li>
    </ul>`],
    ["A good routine", `<p>Add games, run <b>Scrape</b> to fill in missing art, then <b>Sync</b> to put it on the handheld. The size pictures are saved at
      is set in Settings under <b>Uploaded artwork size</b>.</p>`],
  ]],
  ["apps", "package", "Apps", "apps", "Find apps in the App market, install them and updates on the handheld, and keep them current.", [
    ["Packages", `<p>MustardOS installs software from package files: <code>.muxapp</code> for apps, <code>.muxupd</code> for updates and add-ons, and <code>.muxzip</code> for other bundles such as themes.
      They sit in your <code>apps</code> folder; the <b>App market</b>, <b>Add packages</b> or dragging files onto the page puts them there.</p>`],
    ["App market", `<p><b>App market</b> at the top of Apps lists popular MustardOS apps, such as Scrappy, Artie, Grout and Bluetooth, with
      screenshots, GitHub stars, the latest release notes and links to each app's GitHub page and releases. Click a picture or <b>About</b> for the details.</p>
      <ul>
        <li><b>Runs on the &hellip;</b> hides apps that cannot work on your handheld model, for example apps that need Wi-Fi on a model without it.
          Badges warn about the rest: <i>Made for</i> another handheld, <i>No longer developed</i>, or a <i>Pre-release</i>.</li>
        <li><b>Get</b> downloads the package that suits your handheld into the <code>apps</code> folder. Many apps publish one package per handheld
          maker or MustardOS release; the manager picks the right one, and matches the MustardOS release once the handheld is connected over SSH.
          <b>About</b> lists every package in the release if you want a different one.</li>
        <li>Then <b>Send</b> it, or <b>Send and install</b> over Wi-Fi, as described below. Apps already on the handheld show <i>Installed</i>;
          <b>Reinstall</b> in About replaces the app with the package in your <code>apps</code> folder, for example to update it.</li>
      </ul>
      <p>The apps come from their makers' GitHub releases and are not checked by MustardOS, so read an app's page before installing it.
        The list is checked again every 12 hours; <b>Refresh</b> checks now.</p>`],
    ["Send, then install", `<ol>
      <li><b>Send</b> copies a package into the handheld's <code>ARCHIVE</code> folder. It shows under <b>Waiting in ARCHIVE</b>.</li>
      <li><b>Install</b> runs MustardOS's Archive Manager on the handheld over Wi-Fi with SSH. The handheld's menu closes while it works and comes back when it is done.
        You can also open Archive Manager on the handheld yourself.</li>
    </ol>
    <p>Archive Manager cannot install plain <code>.zip</code> files; only MustardOS packages.</p>`],
    ["Installed applications", `<p>Lists the apps on the handheld. <b>Uninstall</b> removes one from the handheld; this is permanent.</p>`],
    ["Updates", `<p>The <b>Updates</b> panel checks the MustardOS website and GitHub. <b>Check now</b> asks again.</p>
      <ul>
        <li><b>MustardOS</b>: shows the newest release and whether your handheld runs it. Point releases such as 2601.1 keep the version number of the
          release they update, so the handheld is recognised by its build id instead (the code at the end of the image name, like <code>bc38efa0</code>).
          <b>Update in place</b> is an Archive Manager package for your current version; download it, add it, then send and install it. Saves and settings stay.
          <b>Fresh install</b> writes the full image to SD1 in System Tools and erases that card, so back up your saves first.
          If the image in your <code>os</code> folder matches the official checksum, it says so.</li>
        <li><b>Apps</b>: compares your packages with their latest GitHub release. A download button saves the new package into your <code>apps</code> folder.
          <i>Newer than GitHub</i> means your copy came from somewhere else with its own numbering; nothing to do.</li>
      </ul>`],
  ]],
  ["handheld", "sliders", "Device Settings", "handheld", "Change the handheld's MustardOS settings from here.", [
    ["What it is", `<p>The same options as the handheld's own ${path("Configuration")} screens (General Settings, Power, Interface, Customisation and more),
      changed over Wi-Fi with SSH.</p>`],
    ["Changing settings", `<p>Change as many options as you like; they are collected and written together when you save. Each option says when the change takes
      effect: right away, the next time a menu screen loads, the next time Wi-Fi connects, or the next time the handheld starts.</p>`],
    ["Undo", `<p><b>Undo last save</b> puts back the values from before your last save.</p>`],
    ["Finding an option", `<p>Use the search box. <b>Advanced</b> shows options most people never need.</p>`],
  ]],
  ["themes", "palette", "Themes", "themes", "Browse MustardOS themes, design your own, and install and apply them on the handheld.", [
    ["Browse", `<p>Lists the themes from the MustardOS theme library (<a href="https://theme.muos.dev" target="_blank" rel="noopener">theme.muos.dev</a>),
      the same list as ${path("Configuration", "Customisation", "Theme Picker", "Theme Download")} on the handheld. By default only themes made for your
      handheld's screen size are shown; pick <b>Every screen size</b> to see the rest. Click a preview to look closer; some themes have an animated one.</p>`],
    ["Install and apply", `<p><b>Install and apply</b> downloads the theme, copies it into <code>MUOS/theme</code> on SD1 and makes it the active theme.
      The handheld's menu closes and comes back with it a few seconds later, the same as picking it in the Theme Picker, and the boot logo changes with it.
      <b>Install</b> only adds it, so you can switch to it later from here or on the handheld. Applying waits until the handheld is back in its menus;
      it will not interrupt a game.</p>`],
    ["On the handheld", `<p>Shows every installed theme with its own preview screens, the theme MustardOS version it was made for and its size.
      <b>Apply</b> switches to it; the bin button deletes it from the handheld. The active theme cannot be deleted, and deleting is permanent.</p>`],
    ["Designer", `<p>Makes your own themes on this computer, kept in the <b>themes</b> folder (one folder per theme, the same layout as
      <code>MUOS/theme</code>; move it in Settings). Start fresh with a palette and screen sizes, or from a library theme, a theme on the handheld,
      one of your own or a <code>.muxthm</code> file. Every change is saved as you make it; Ctrl+Z and Ctrl+Shift+Z undo and redo.</p>
      <p>The preview on the right draws the main menu, Explore, Configuration, a settings list, pop-ups, the keyboard, the passcode wheel, the charging
      screen and the boot logo from the theme's settings and pictures, at each screen size and colour variant. Click any part to open its settings.</p>
      <p><b>Quick style</b> sets many colours at once from a palette or six colour roles, plus roundness, items per page, bar heights and a list or grid
      main menu. The groups below it hold every scheme setting MustardOS reads, with colours and opacity side by side.</p>`],
    ["Where changes go", `<p>MustardOS reads a theme's settings in layers: <code>scheme/global.ini</code>, then <code>default.ini</code>, then the screen's
      own file (each from the screen size folder when there, otherwise the theme root), then the colour variant. <b>Changes go to</b> picks the file:
      the whole theme, one screen size, one screen, or a colour variant. Rows set in the chosen file have a mustard mark and a reset button; the others
      say which file their value comes from, and a value hidden by a more specific file says so.</p>`],
    ["Pictures, icons, fonts and sounds", `<p><b>Pictures</b> holds the wallpaper, boot logo, charging, overlay and other screens, wallpapers per screen
      and per main menu item, and the preview pictures the theme picker shows (drawn for you on export or install when missing). <b>Icons</b> fills the
      glyph folders (main menu, button hints, status icons and more) and the grid pictures; drop a set of PNGs named like the slots on a folder.
      Each can be for every screen size or only one.</p>
      <p><b>Fonts</b> keeps TTF, OTF or WOFF fonts with the theme and converts them into MustardOS fonts for the whole theme, list items, the header or the
      footer, at the size and character set you pick (with LVGL's <code>lv_font_conv</code>, fetched by npx the first time); the preview then uses the
      font too. <b>Sounds</b> takes WAV files for navigation, confirm, back and the rest.</p>`],
    ["Export, install and apply", `<p><b>Export</b> saves the theme as a <code>.muxthm</code> file to share or copy to <code>MUOS/theme</code> yourself.
      <b>Install</b> copies it to the handheld over Wi-Fi, replacing a copy with the same name; <b>Install and apply</b> also makes it the active theme.
      <b>Details and sizes</b> sets the display name, credits, the MustardOS version it is made for and its screen sizes; <b>Colour variants</b> adds the
      alternate colour sets people pick in the theme picker. Removing a file, a size or a theme moves it to the Trash on this computer.</p>`],
    ["What it needs", `<p>Browsing and previews need only an internet connection, and the Designer works offline. Installing, applying and deleting need
      the handheld over Wi-Fi with ${SSH_ON}, and MustardOS 2601.0 or newer, which keeps themes as folders.</p>`],
  ]],
  ["emulation", "save", "Emulation", "emulation", "Saves, BIOS files, emulator cores and a health check of your library.", [
    ["Saves", `<p>Backs up every save game and save state from the handheld into your <code>backups</code> folder, one compressed file per backup.</p>
      <ul>
        <li><b>Back up now</b> takes a backup. The handheld panel shows how many files changed since the last one.</li>
        <li>Open a backup to see its files, compare them with the handheld, and restore all of them or only the ones you tick.</li>
        <li>Before a restore replaces anything, the manager first backs up what is on the handheld (labelled <i>Before a restore</i>), so a restore can be undone.</li>
      </ul>`],
    ["BIOS", `<p>Some systems (PlayStation, Sega CD, Game Boy Advance and others) need a BIOS file: a copy of the original console's startup chip.
      Without it, games for that system may not start.</p>
      <ul>
        <li>Each system lists the files it needs and the optional ones, and whether you have them here and on the handheld.</li>
        <li>Files are checked by their fingerprint (MD5), so you know a file is the right one, not just named right.</li>
        <li><b>Add BIOS files</b> (or drop files on the page) stores recognised files in your <code>bios</code> folder under the name MustardOS expects.</li>
        <li><b>Send</b> copies them to the handheld and checks them again there.</li>
      </ul>`],
    ["Cores", `<p>A <i>core</i> is the emulator program that runs a game. Some systems have several; one may run a game better than another.</p>
      <ul>
        <li>Each ROM folder on the handheld shows its system and core. <i>Automatic</i> means MustardOS picks from the folder name.</li>
        <li><b>Change</b> sets the system and core for a whole folder. <b>Keep the games with their own core</b> leaves games that you gave their own core alone.</li>
        <li>You can also give one game its own core, and later switch it back with <b>Use the folder's core</b>.</li>
        <li>MustardOS also remembers a core per game when you start a game with a different core on the handheld.</li>
        <li><i>Needs a system</i> means MustardOS has no system with the folder's name. The note under the folder says why: its games may run under
          another system (MAME and CPS folders under Arcade, FDS under NES), it may need an extra core, or nothing on the handheld runs it.</li>
      </ul>`],
    ["Systems", `<p>Lists every system the manager knows, grouped like the Games section, with what MustardOS on the handheld can do with it.
      By default only systems with games in your library are shown; <b>Show all systems</b> lists the rest.</p>
      <ul>
        <li><b>On the handheld</b>: MustardOS has the system, shown with its default core and how many cores it has.</li>
        <li><b>Pick its system</b>: the games run under another MustardOS system. Set it for the folder in the Cores tab.</li>
        <li><b>Needs an extra core</b>: MustardOS 2601 Jacaranda leaves the system out (Sega Saturn, Nintendo DS, WonderSwan, Virtual Boy, MSX,
          the smaller Atari machines and others). Newer MustardOS versions offer optional cores for them under
          ${path("Configuration", "Advanced Settings", "Extra Cores")}. Some, like the Saturn, are too demanding to run well on these handhelds.</li>
        <li><b>No core</b>: nothing in MustardOS runs these games, such as PolyGame Master 2 and OpenBOR.</li>
      </ul>
      <p>The list needs the handheld over Wi-Fi with Secure Shell on, like the Cores tab.</p>`],
    ["RetroArch", `<p>Most systems run in RetroArch. This tab sets its picture and play options per ROM folder, without opening RetroArch's menu on the handheld:
      aspect ratio, integer scaling, smoothing, shader, overlay (screen border) and its opacity, rewind and the FPS counter.</p>
      <ul>
        <li><b>Defaults</b> shows what every folder uses unless it has its own options.</li>
        <li><b>Only &lt;folder&gt;</b> saves options for that ROM folder. <b>Every folder using &lt;core&gt;</b> saves them for the core, so all folders that use
          it change together (for example GB and GBC with Gambatte). Options for a single folder win over options for the core.</li>
        <li><b>Default</b> in a list means "not set here", and shows what applies instead. <b>Back to defaults</b> clears everything for that scope.</li>
        <li>The options are written as RetroArch override files on the handheld; changes apply the next time a game starts. Folders whose core is not
          part of RetroArch (PSP, ScummVM, ports) are listed separately.</li>
      </ul>`],
    ["Library check: verify dumps", `<p>A game file is a <i>dump</i>: a copy of the original cartridge. The No-Intro project keeps a list of known good dumps.
      <b>Check</b> compares each of your files with that list. Nothing is changed; zip files are read without unpacking.</p>
      <ul>
        <li><b>Verified</b>: an exact copy of a good dump. If No-Intro uses another name, it is shown; the game is fine.</li>
        <li><b>Bad dump</b>: the game is known but your file differs: too small (incomplete), too big, or modified. It may crash or glitch; replace it if it does.</li>
        <li><b>Not in No-Intro</b>: homebrew, unlicensed games, or names No-Intro doesn't use.</li>
        <li><b>Translation or hack</b>: patched games are never in the list; that's expected.</li>
        <li><b>Not checked</b>: for example <code>.7z</code> archives, which can't be read quickly.</li>
      </ul>
      <p>The <b>bin</b> button on a row moves that game to the Trash on this computer, optionally with its artwork. A folder with several bad dumps
      also has a button that moves all of them to the Trash at once. Nothing on the handheld is touched; remove it there from Games if it was copied.</p>
      <p>Arcade, CD-based and engine folders (PlayStation, ScummVM and so on) are not covered.</p>`],
    ["Library check: duplicates", `<p>Finds games you have more than once in the same folder: other regions, revisions or file formats. One version is
      <i>Suggested</i> to keep, chosen by the region you prefer (USA, Europe or Japan first), then good dumps over betas and prototypes, then the newest
      revision. The others are ticked; untick anything you want to keep, then <b>Move to the Trash</b>. You are warned if every version of a game is ticked.
      Arcade folders are skipped because their clone sets need the parent set.</p>`],
  ]],
  ["files", "folder", "Files", "files", "Browse this computer and the handheld side by side, copy between them, and edit config files.", [
    ["Two sides", `<p>The left side is this computer: your workspace, plus the Roms, apps, OS, BIOS and backup folders if Settings points them elsewhere.
      The right side is the handheld: SD1 (MustardOS) and TF2 (games), over the card reader, USB or Wi-Fi. Pick a place in the list at the top of each side,
      click a folder to open it, and use the path or the up arrow to go back.</p>`],
    ["Picking and copying", `<p>Click rows or tick them to pick files and folders, then <b>Copy to handheld</b> or <b>Copy to computer</b>. They land in the
      folder open on the other side. You are told how much will be copied and asked before anything already there is replaced. Copies show in the
      Transfers panel like game copies: they can wait in line behind another copy, and can be stopped.</p>`],
    ["Rename, new folder, delete", `<ul>
      <li>The buttons above each list make a new folder, rename the one picked item, or delete the picked items.</li>
      <li>On this computer, deleting moves things to the Trash. On the handheld it is permanent, including everything inside a folder.</li>
      <li>Renaming on the handheld is not possible over USB; use Wi-Fi or a card reader.</li>
      <li>SD1's <code>MUOS</code> folder holds MustardOS itself. The manager warns you before you change anything there.</li>
    </ul>`],
    ["Preview and edit", `<p>Click a file name to open it. Pictures are shown; text and config files (<code>.cfg</code>, <code>.ini</code>, <code>.json</code>,
      <code>.txt</code> and similar, up to 512 KB) open in an editor. <b>Save</b> (or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd>) writes the file back.</p>`],
  ]],
  ["tuning", "gauge", "Game Tuning", "tuning", "Per-game emulator settings, cheats and CPU governor.", [
    ["What it does", `<p>Some games need more than the handheld can give at the emulator's usual settings: God of War on PSP, Perfect Dark on N64, most
      Dreamcast games. Others have power to spare and could look sharper. Game Tuning gives one game its own settings without changing any other game.
      It needs the handheld on Wi-Fi with SSH on, and the changes apply the next time the game starts.</p>`],
    ["Pick a game", `<p>The list on the left shows your library. Open the system list and type a few letters to narrow it (arrow keys and Enter work
      too); systems with emulator settings come first. Then search by name; <i>Tuned</i> marks games that already have their own settings.
      The page then shows which emulator starts the game (its own core if it has one, else its folder's) and what it can change:</p>
      <ul>
        <li><b>PSP</b>: PPSSPP, standalone or the RetroArch core. Standalone PPSSPP keeps settings under the disc ID (like <code>ULUS10391</code>),
          read from the ISO, CSO or PBP file. For CHD files, type the ID; PPSSPP shows it under Game settings &rsaquo; Game info.</li>
        <li><b>N64</b>: Mupen64Plus-Next. <b>PlayStation</b>: PCSX-ReARMed, SwanStation, DuckStation. <b>Dreamcast, NAOMI, Atomiswave</b>: Flycast.</li>
        <li><b>Every game</b>: its own CPU governor. For emulators with no per-game settings (for example the standalone N64 and Dreamcast emulators)
          this is the only option; switch the game to one of the cores above in Emulation &rsaquo; Cores for more.</li>
      </ul>
      <p>A game does not have to be on the handheld yet: settings saved now apply once you copy it.</p>`],
    ["Presets and recommendations", `<p><b>Fastest</b>, <b>Balanced</b> and <b>Best looking</b> fill in the settings for you. Known heavy games get a
      recommendation with a short reason, for example Fastest with the performance governor for God of War. It is a starting point for your handheld's
      chip: play a few minutes, then adjust. Every setting says whether it buys <i>Speed</i>, <i>Looks</i> or both, and what it costs.</p>
      <p><i>Default</i> means the value the game uses today, from its folder's or core's options, or from PPSSPP's own settings.</p>`],
    ["Save and undo", `<p><b>Save to handheld</b> writes the game's own settings file. It starts as a copy of what the game used before, so only the
      settings you changed differ; PPSSPP's buttons are kept too. <b>Back to folder settings</b> removes the game's own file and governor again. For
      standalone PPSSPP that also removes settings made for the game in PPSSPP's own menu.</p>
      <p>Files on the handheld: <code>info/config/&lt;core&gt;/&lt;game&gt;.opt</code> for RetroArch cores,
      <code>emulator/ppsspp/.config/ppsspp/PSP/SYSTEM/&lt;disc ID&gt;_ppsspp.ini</code> for PPSSPP, and <code>info/content/&lt;folder&gt;/&lt;game&gt;.gov</code>
      for the governor, the same file the handheld's own per-game governor option writes.</p>`],
    ["Cheats", `<p>The <b>Cheats</b> panel below a game's settings lists cheats you can tick, and <b>Save cheats</b> puts them on the handheld so
      they switch on the next time the game starts.</p>
      <ul>
        <li><b>RetroArch cores</b> (most systems): cheats come from the libretro cheat database, matched by the game's file name, so No-Intro and
          Redump names (like <code>Super Mario World (USA)</code>) find the most. Some games have one file per cheat device (Action Replay,
          Game Genie, GameShark); pick one under <i>Cheats from</i>. They are saved as <code>cheats/&lt;core&gt;/&lt;game&gt;.cht</code>, the file
          RetroArch loads by itself.</li>
        <li><b>Standalone PPSSPP</b>: MustardOS ships cheat files for several hundred PSP games, some with fixes like 60 FPS patches. The panel shows
          that file and switches its cheats on and off; for other games it finds the libretro database's file by disc ID.</li>
        <li>Standalone emulators other than PPSSPP do not load cheat files; give the game a RetroArch core in Emulation &rsaquo; Cores to use them.</li>
      </ul>
      <p>RetroArch only switches saved cheats on at start-up when <b>Apply cheats after game load</b> is on, and MustardOS ships it off. When it is
        off, the panel offers to turn it on (games without cheats are not affected); PPSSPP's own cheat setting is handled the same way.
        <b>Remove cheats</b> deletes a RetroArch game's cheat file. Cheats can upset saves and game logic, so switch them off again if a game misbehaves,
        and close the game on the handheld before saving.</p>`],
  ]],
  ["system", "sd", "System Tools", "system", "Prepare SD cards: install MustardOS, set up a games card, or wipe a card.", [
    ["Before you start", `<p>Put the card in this computer's card reader. Only removable cards are offered; your computer's own disks never are.
      All three tools <b>erase the card</b>, so back up your saves first (Emulation &rsaquo; Saves). Your computer may ask for your password to write to the card.</p>`],
    ["Install MustardOS", `<p>Writes a MustardOS image from your <code>os</code> folder onto the SD1 (system) card, then reads it back to check it was written correctly.</p>`],
    ["Set up TF2", `<p>Formats a games card and creates the <code>ROMS</code> folders MustardOS expects, ready for Games &rsaquo; copy to the handheld.</p>`],
    ["Reset card", `<p>Wipes a card to one empty FAT32 or exFAT volume, for example to reuse it for something else.</p>`],
  ]],
  ["ssh", "chip", "SSH", "ssh", "A command line on the handheld, plus a quick look at its system.", [
    ["What it is", `<p>A terminal connected to the handheld over Wi-Fi, for people comfortable with Linux commands. It needs ${SSH_ON} on the handheld.</p>`],
    ["What else is there", `<p><b>Quick commands</b> run common checks with one click. <b>Storage</b> shows how full each card is, and <b>Busiest processes</b>
      shows what is using the processor.</p>`],
    ["Be careful", `<p>Commands run as the administrator (root) of the handheld. A wrong command can delete files or stop MustardOS from starting.</p>`],
  ]],
  ["settings", "wrench", "Settings", "settings", "Where the manager keeps things, and how it looks and behaves.", [
    ["Folders", `<p><b>Roms folder</b> is where your game library lives, for example on an external drive. <b>Other folders</b> set where apps, MustardOS
      images, BIOS files, save backups and the themes you design are kept.</p>`],
    ["Behaviour and looks", `<p><b>Transfers, startup and updates</b> controls how copying and starting up behave, and adds the app shortcut. <b>Appearance, clock and images</b> sets the theme,
      the date and clock format, and the size uploaded artwork is saved at.</p>`],
    ["Game data and cache", `<p><b>Game data</b> refreshes the game descriptions and arcade titles. <b>Cache</b> clears downloaded previews and lists:
      scraper file lists, artwork previews read from the handheld, the online catalogues (PortMaster, App market, themes and MustardOS updates) and
      ROM check results. They are fetched or worked out again when needed.</p>`],
    ["History and resets", `<p>Start some things over:</p>
      <ul>
        <li><b>Activity log</b> clears Recent activity on Overview.</li>
        <li><b>View preferences</b> forgets the sorting, layout, open tabs, theme, clock and scraper choices this browser remembers. The connection,
          handheld model and SSH snippets stay.</li>
        <li><b>Play time</b> resets the launches and time played that MustardOS recorded, and <b>Recently played</b> clears the History list in the
          handheld's menu. Both change the handheld, so connect it over USB or Wi-Fi first; they cannot be undone.</li>
      </ul>`],
    ["Factory reset", `<p>The red panel at the bottom starts the manager over as if it had just been installed. It moves to the Trash:</p>
      <ul>
        <li>the workspace folders you leave ticked: Roms (your whole game library and its artwork), apps, os, bios, backups and themes;</li>
        <li>everything in the manager's <code>.cache</code> folder: settings and chosen folders, Wi-Fi and SSH logins, downloaded game data and
          catalogues, ROM check results and the activity log;</li>
        <li>this browser's view preferences.</li>
      </ul>
      <p>Then it creates empty workspace folders, restarts and opens the setup wizard. Type <b>RESET</b> to confirm. The handheld and its cards are
        not touched, and neither is the app shortcut. Nothing is deleted outright, so you can get it back from the Trash until you empty it. On a
        Mac, a folder on another drive is left where it is instead of being copied to the Trash; delete it yourself if you want it gone.
        When the manager was not started with <code>run.sh</code> or <code>run.cmd</code> it stops instead of restarting, so start it again.</p>`],
  ]],
  ["glossary", "book", "Glossary", "", "Words you will see around the manager.", [
    ["Terms", `<dl class="wiki-dl">
      <dt>SD1</dt><dd>The card in the handheld's first slot, holding MustardOS itself.</dd>
      <dt>TF2</dt><dd>The card in the second slot, holding your games (<code>ROMS</code>), artwork and packages (<code>ARCHIVE</code>). One-slot handhelds, such as the TrimUI models, keep MustardOS and games on one SD card.</dd>
      <dt>ROM</dt><dd>A game file: a copy of a cartridge or disc.</dd>
      <dt>Dump</dt><dd>How a ROM was copied from the original. A good dump is an exact copy.</dd>
      <dt>No-Intro</dt><dd>A project that lists known good cartridge dumps and their official names.</dd>
      <dt>Region</dt><dd>Where a release was sold: USA, Europe, Japan, World and so on. Versions can differ in language and speed.</dd>
      <dt>Revision (Rev 1, v1.1)</dt><dd>A later version of a game, usually with bugs fixed.</dd>
      <dt>Core</dt><dd>The emulator program that runs games for a system.</dd>
      <dt>BIOS</dt><dd>A copy of a console's startup chip that some cores need.</dd>
      <dt>MD5, CRC</dt><dd>Short fingerprints of a file's contents, used to check a file is exactly the right one.</dd>
      <dt>.muxapp, .muxupd</dt><dd>MustardOS package files for apps and for updates or add-ons.</dd>
      <dt>Archive Manager</dt><dd>The MustardOS tool that installs packages from the <code>ARCHIVE</code> folder.</dd>
      <dt>SFTP</dt><dd>A way to copy files over Wi-Fi; MustardOS calls it SFTP + Filebrowser.</dd>
      <dt>SSH</dt><dd>A secure remote command line; the manager uses it to change things on the handheld.</dd>
      <dt>MTP</dt><dd>The USB mode that lets a computer see the handheld's files over a cable.</dd>
      <dt>Save state</dt><dd>A snapshot of a game at any moment, made by the emulator; different from the game's own save.</dd>
      <dt>Port</dt><dd>A PC game rebuilt to run natively on handhelds, instead of in an emulator.</dd>
      <dt>PortMaster</dt><dd>The app on MustardOS that downloads, installs and removes ports. The manager asks it to do the work over SSH.</dd>
      <dt>Runtime</dt><dd>A shared engine some ports need (for example Godot or .NET). PortMaster downloads it once and every port that needs it uses it.</dd>
      <dt>Ready to run</dt><dd>A port that comes with everything it needs. The others need files from your own copy of the game.</dd>
      <dt>ScummVM</dt><dd>A program that runs classic point-and-click adventures from their original data files.</dd>
      <dt>.scummvm file</dt><dd>The empty file the handheld lists for a ScummVM game. The game itself sits in the data folder next to it.</dd>
    </dl>`],
  ]],
  ["help", "info", "Troubleshooting", "", "Common problems and what to try.", [
    ["The handheld isn't found over USB", `<ul>
      <li>On the handheld set ${path("Configuration", "Advanced Settings", "USB Function")} to <b>MTP</b>.</li>
      <li>Unplug the cable, wait until the handheld has finished starting, and plug it in again. Plugged in while the handheld (or the
        computer) starts, its USB port can come up in the wrong mode, and the computer then sees no device at all.</li>
      <li>On a Mac, unlock it before plugging in and click <b>Allow</b> on the accessory prompt. Without a prompt, check System Settings
        &rsaquo; Privacy &amp; Security &rsaquo; Allow accessories to connect.</li>
      <li>Try another USB-C cable or port: charge-only cables look the same but carry no data.</li>
      <li>Quit apps that grab MTP devices (Android File Transfer, OpenMTP, Image Capture), or use <b>Use Wi-Fi</b> in the meantime.</li>
    </ul>`],
    ["The handheld can't be reached over Wi-Fi", `<ul>
      <li>Check both are on the same Wi-Fi network and the handheld is awake; it drops Wi-Fi while asleep.</li>
      <li>On the handheld turn on ${SFTP_ON} and, for SSH features, ${SSH_ON}.</li>
      <li>The address may have changed: use <b>Find on network</b> in Overview's Wi-Fi settings.</li>
    </ul>`],
    ["A game doesn't start or crashes", `<ul>
      <li>Emulation &rsaquo; BIOS: does its system need a BIOS file that is missing on the handheld?</li>
      <li>Emulation &rsaquo; Cores: try another core for the folder or just that game.</li>
      <li>Emulation &rsaquo; Library check: is the file a bad dump?</li>
    </ul>`],
    ["Games or artwork don't show on the handheld", `<ul>
      <li>Games must be in the right system folder inside <code>ROMS</code> on the TF2 card.</li>
      <li>Artwork needs to be synced: Artwork &rsaquo; Sync. Missing art can be downloaded with Scrape first.</li>
      <li>After copying, go back to the handheld's main menu so it reloads the list.</li>
    </ul>`],
    ["A port won't install", `<ul>
      <li>PortMaster downloads on the handheld itself, so the handheld needs internet access over Wi-Fi, not just a connection to this computer.</li>
      <li>Go back to the handheld's main menu first; installs are refused while a game or app is running.</li>
      <li>The last line PortMaster printed shows in the Ports section. Opening the PortMaster app on the handheld once can repair it.</li>
      <li>A port that installed but shows a black screen usually needs game files; open it in Ports and check its <b>Game files</b> notes.</li>
    </ul>`],
    ["A ScummVM game isn't recognised", `<ul>
      <li>The <code>.scummvm</code> file and its data folder must have the same name (<code>Lure.scummvm</code> with <code>.Lure/</code>, <code>_Lure/</code> or <code>Lure/</code>).</li>
      <li>The data folder must hold the game's own files directly, not another folder inside it.</li>
      <li>Some games need an engine this handheld's ScummVM was not built with; the free games in Games all work.</li>
    </ul>`],
    ["The page says the token is wrong", `<p>Each start of the manager makes a new private address. Close this tab and open the manager again from
      <code>muos-anbernic-manager/run.sh</code> (or the address printed in its terminal window).</p>`],
  ]],
];

/** The Wiki page lists every article; the help dialog shows one at a time, starting with the open section's. */
const VIEWS = {
  page: { root: "wiki", pre: "wiki", q: "", one: false, bound: false },
  help: { root: "help-wiki", pre: "help", q: "", one: true, at: "start", bound: false },
};

const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&rsaquo;/g, ">").replace(/&[a-z]+;/g, " ").toLowerCase();

function matches(article, q) {
  const [, , title, , summary, parts] = article;
  if (!q) return parts;
  if (plain(`${title} ${summary}`).includes(q)) return parts;
  return parts.filter(([h, body]) => plain(`${h} ${body}`).includes(q));
}

function render(v) {
  const root = $(v.root);
  if (!root) return;
  const q = v.q.trim().toLowerCase();
  const single = v.one && !q;
  const listed = single ? ARTICLES.map((a) => [a, a[5]]) : ARTICLES.map((a) => [a, matches(a, q)]).filter(([, parts]) => parts.length);
  const shown = single ? listed.filter(([[id]]) => id === v.at) : listed;
  const here = v.one ? section() : "";
  const toc = listed.map(([[id, ico, title]]) => `<a href="#wiki" data-wiki="${id}"${single && id === v.at ? ` class="on" aria-current="true"` : ""}>${icon(ico)}<span>${esc(title)}</span></a>`).join("");
  const body = shown.map(([[id, ico, title, go, summary], parts]) => `<section class="panel wiki-article" id="${v.pre}-${id}">
      <h2>${icon(ico)}${esc(title)}<span class="grow"></span>${go && go !== here ? `<a class="btn small" href="#${go}">${icon("arrow")}<span>Open ${esc(title)}</span></a>` : ""}</h2>
      <p class="wiki-summary">${esc(summary)}</p>
      ${parts.map(([h, html]) => `<div class="wiki-part"><h3>${esc(h)}</h3>${html}</div>`).join("")}
    </section>`).join("");
  root.innerHTML = `<div class="wiki-layout">
      <aside class="wiki-side">
        <div class="search wiki-search">${icon("search")}<input id="${v.pre}-q" type="search" placeholder="Search the wiki" aria-label="Search the wiki" autocomplete="off" spellcheck="false" value="${esc(v.q)}"></div>
        <nav class="wiki-toc" aria-label="Wiki pages">${toc}</nav>
      </aside>
      <div class="wiki-body">${body || `<div class="notice">Nothing in the wiki mentions &ldquo;${esc(v.q)}&rdquo;.</div>`}</div>
    </div>`;
}

/** Centres the open article in the contents row when it scrolls sideways (phones). */
function showActive(root) {
  const toc = root.querySelector(".wiki-toc"), on = toc?.querySelector(".on");
  if (on && toc.scrollWidth > toc.clientWidth) toc.scrollLeft += on.getBoundingClientRect().left - toc.getBoundingClientRect().left - (toc.clientWidth - on.offsetWidth) / 2;
}

function bind(v) {
  if (v.bound) return;
  v.bound = true;
  const root = $(v.root);
  root.addEventListener("input", (e) => {
    if (e.target.id !== `${v.pre}-q`) return;
    v.q = e.target.value;
    const at = e.target.selectionStart;
    render(v);
    const input = $(`${v.pre}-q`);
    input.focus();
    input.setSelectionRange(at, at);
  });
  root.addEventListener("click", (e) => {
    const link = e.target.closest("[data-wiki]");
    if (link) {
      e.preventDefault();
      if (v.one && !v.q.trim()) {
        v.at = link.dataset.wiki;
        render(v);
        root.scrollTop = 0;
        showActive(root);
      } else {
        $(`${v.pre}-${link.dataset.wiki}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (v.one && e.target.closest('a[href^="#"]')) $("help").close();
  });
}

export function showWiki() {
  bind(VIEWS.page);
  render(VIEWS.page);
}

/** Opens the wiki in a dialog at the article for section s, so help can be read without leaving the page. */
export function openHelp(s) {
  const v = VIEWS.help, dialog = $("help");
  if (!v.bound) {
    $("help-close").addEventListener("click", () => dialog.close());
    $("help-full").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  }
  bind(v);
  v.at = ARTICLES.some(([id]) => id === s) ? s : "start";
  v.q = "";
  render(v);
  $("help-full").hidden = s === "wiki";
  if (!dialog.open) dialog.showModal();
  $(v.root).scrollTop = 0;
  showActive($(v.root));
}
