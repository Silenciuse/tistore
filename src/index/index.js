/**
 * Entry point of the application.
 * @module tistore/index
 */

import fs from "fs";
import os from "os";
import React from "react";
import ReactDOM from "react-dom";
import "./package.json.ejs";
import "./index.html.ejs";
import "./icon.png";
import "./opensans-regular.woff2";
import "./opensans-bold.woff2";
import "./opensans-italic.woff2";
import Aria2s from "../aria2c";
import Toolbar from "../toolbar";
import FileList from "../file-list";
import StatusBar from "../status-bar";
import FileDialog from "../file-dialog";
import pkg from "../../package.json";

const Index = React.createClass({
  getInitialState() {
    // Very simple OrderedDict equiavalent.
    this.fileSet = (function() {
      let list = [];
      let hash = Object.create(null);
      return {
        /* View as list. */
        list: list,
        add(file) {
          if (!(file.url in hash)) {
            hash[file.url] = null;
            list.push(file);
          }
        },
        clear() {
          list.length = 0;
          hash = Object.create(null);
        },
      };
    })();
    const outDir = process.env.TISTORE_DEBUG_DIR || os.tmpdir();
    return {
      outDir,
      threads: 16,
      aspawning: true,
      files: this.fileSet.list,
    };
  },
  componentWillMount() {
    const list = process.env.TISTORE_DEBUG_LIST;
    if (list) {
      this.handleListLoad(list);
    }
  },
  componentDidMount() {
    let mainWindow = window.nw.Window.get();
    mainWindow.on("close", () => {
      if (confirm("Are you sure you want to exit?")) {
        // NOTE(Kagami): aria2 process will be killed by onexit handler;
        // it should be rather safe since we send SIGTERM and aria2
        // should do all needed cleanup before exit.
        mainWindow.close(true);
      }
    });
    this.setMenu();
    this.spawnAria();
  },
  componentDidUpdate() {
    // NOTE(Kagami): It's not possible to disable submenu on Linux (see
    // <https://github.com/nwjs/nw.js/issues/2312>), so we block all its
    // subelements instead.
    // NOTE(Kagami): There were some issues with dynamic updates on
    // Windows, see: <https://github.com/nwjs/nw.js/issues/2519>.
    const isReady = !this.state.aspawning && !this.state.aerror;
    const hasLinks = !!this.state.files.length;
    this.addLinksItem.enabled = isReady;
    this.exportLinksItem.enabled = isReady && hasLinks;
    this.clearLinksItem.enabled = isReady && hasLinks;
  },
  setMenu() {
    this.addLinksItem = new window.nw.MenuItem({
      label: "Add from file",
      click: this.handleLinksAdd,
    });
    this.exportLinksItem = new window.nw.MenuItem({
      label: "Export to file",
      click: this.handleLinksExport,
    });
    this.clearLinksItem = new window.nw.MenuItem({
      label: "Clear list",
      click: this.handleLinksClear,
    });
    let linksMenu = new window.nw.Menu();
    linksMenu.append(this.addLinksItem);
    linksMenu.append(this.exportLinksItem);
    linksMenu.append(this.clearLinksItem);
    let linksItem = new window.nw.MenuItem({label: "Links"});
    linksItem.submenu = linksMenu;

    let helpMenu = new window.nw.Menu();
    helpMenu.append(new window.nw.MenuItem({
      label: "About",
      click: this.handleAboutClick,
    }));
    helpMenu.append(new window.nw.MenuItem({
      label: "Official site",
      click: this.handleSiteClick,
    }));
    let helpItem = new window.nw.MenuItem({label: "Help"});
    helpItem.submenu = helpMenu;

    let menu = new window.nw.Menu({type: "menubar"});
    menu.append(linksItem);
    menu.append(helpItem);
    let mainWindow = window.nw.Window.get();
    mainWindow.menu = menu;
  },
  spawnAria() {
    const ariap = Aria2s.spawn();
    process.addListener("exit", () => {
      // Always stop spawned process on exit.
      // TODO(Kagami): Unfortunately nw doesn't fire this event on
      // "Reload app" thus leaving aria2 process untouched.
      try {
        ariap.kill();
      } catch(e) {
        /* skip */
      }
    });
    ariap.then(aria2c => {
      aria2c.on("close", this.handleAriaDisconnect);
      return aria2c.connect().then(() => {
        this.setState({aspawning: false});
        this.aria2c = aria2c;
        this.setDir(this.state.outDir);
        this.handleThreadsChange(this.state.threads);
      });
    }).catch(err => {
      this.setState({aspawning: false, aerror: err});
    });
  },
  styles: {
    main: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
    },
    fileList: {
      flex: 1,
      overflowY: "scroll",
      border: "solid #a9a9a9",
      borderWidth: "1px 0",
    },
  },
  handleLinksAdd() {
    this.refs.openFile.select().then(f => this.handleListLoad(f.path));
  },
  handleListLoad(fpath) {
    // FIXME(Kagami): Handle read errors.
    const data = fs.readFileSync(fpath, {encoding: "utf-8"});
    data.trim().split(/\r?\n/).forEach(line => {
      line = line.trim();
      // Should be enough for now. Leaving to aria2 all remaining
      // validation.
      if (line.startsWith("http://") || line.startsWith("https://")) {
        this.fileSet.add({url: line});
      }
    });
    this.setState({files: this.fileSet.list});
  },
  handleLinksExport() {
    this.refs.saveFile.select().then(file => {
      const data = this.state.files.map(f => f.url).join(os.EOL);
      // FIXME(Kagami): Handle write errors.
      fs.writeFileSync(file.path, data);
    });
  },
  handleLinksClear() {
    this.fileSet.clear();
    this.setState({files: this.fileSet.list});
  },
  setDir(outDir) {
    this.aria2c.setOption("dir", outDir);
    this.setState({outDir});
  },
  handleSetDir() {
    this.refs.openDir.select().then(d => this.setDir(d.path));
  },
  handleAboutClick() {
    alert(pkg.about);
  },
  handleSiteClick() {
    global.nw.Shell.openExternal(pkg.homepage);
  },
  handleThreadsChange(threads) {
    this.aria2c.setOption("max-concurrent-downloads", threads);
    this.setState({threads});
  },
  handleAriaDisconnect() {
    // FIXME(Kagami): Update status bar.
    // NOTE(Kagami): We may try to respawn aria2 daemon here but too
    // much effort. Just suggest user to restart program...
  },
  runDownload() {
    if (this.state.downloading) return;
    this.setState({downloading: true});
    this.state.files.forEach(file => {
      this.aria2c.add(file.url).then(gid => {
        const updateUI = () => {
          this.setState({files: this.state.files});
        };
        const removeListeners = () => {
          // Allow GC to free memory.
          this.aria2c.removeAllListeners(`start.${gid}`);
          this.aria2c.removeAllListeners(`pause.${gid}`);
        };

        file.gid = gid;
        // Happen each time user clicks start/pause button.
        this.aria2c.on(`start.${gid}`, () => {
          file.status = "start";
          updateUI();
        });
        this.aria2c.on(`pause.${gid}`, () => {
          file.status = "pause";
          updateUI();
        });
        // These events should happen only once.
        this.aria2c.once(`complete.${gid}`, () => {
          file.status = "complete";
          updateUI();
          removeListeners();
        });
        this.aria2c.once(`error.${gid}`, () => {
          file.status = "error";
          updateUI();
          removeListeners();
        });
      }, () => {
        // FIXME(Kagami): Handle addUri errors.
      });
    });
  },
  handleStartPauseClick() {
    if (this.state.downloading) {
      const pause = !this.state.pause;
      const method = pause ? "pauseAll" : "unpauseAll";
      // FIXME(Kagami): Use pausing/stopping states to be safe against
      // possible races?
      this.aria2c.call(method);
      this.setState({pause});
    } else {
      this.runDownload();
    }
  },
  handleStopClick() {
    if (confirm("Are you sure you want to abort?")) {
      if (this.state.downloading) {
        const files = this.state.files;
        files.forEach(f => this.aria2c.forceRemove(f.gid));
        this.fileSet.clear();
        this.setState({downloading: false, pause: false, files});
      }
    }
  },
  render() {
    return (
      <div style={this.styles.main}>
        <div>
          <Toolbar
            aspawning={this.state.aspawning}
            aerror={this.state.aerror}
            downloading={this.state.downloading}
            pause={this.state.pause}
            files={this.state.files}
            threads={this.state.threads}
            onSetDir={this.handleSetDir}
            onThreadsChange={this.handleThreadsChange}
            onStartPauseClick={this.handleStartPauseClick}
            onStopClick={this.handleStopClick}
          />
        </div>
        <div style={this.styles.fileList}>
          <FileList files={this.state.files} />
        </div>
        <div>
          <StatusBar
            files={this.state.files}
            outDir={this.state.outDir}
            aspawning={this.state.aspawning}
            aerror={this.state.aerror}
          />
        </div>
        <FileDialog ref="openFile" accept=".txt" />
        <FileDialog ref="saveFile" accept=".txt" saveAs="links.txt" />
        <FileDialog ref="openDir" directory />
      </div>
    );
  },
});

ReactDOM.render(<Index/>, document.getElementById("tistore-index"));
