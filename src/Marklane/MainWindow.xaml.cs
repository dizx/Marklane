using System.Collections.ObjectModel;
using System.Reflection;
using System.Text.Json;
using Marklane.Core;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Marklane;

public sealed partial class MainWindow : Window
{
    private const string EditorUrl = "https://marklane.local/index.html";
    private readonly MarkdownDocument document = new();
    private readonly ObservableCollection<HeadingItem> headings = [];
    private bool ready, busy, allowClose, sourceMode, focusMode;
    private bool showOutline = true;
    private readonly string appDataDirectory = Environment.GetEnvironmentVariable("MARKLANE_DATA_DIRECTORY") is { Length: > 0 } configuredDirectory
        ? Path.GetFullPath(configuredDirectory)
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marklane");
    private readonly string settingsPath;
    private readonly RecentFilesStore recentFiles;

    public MainWindow()
    {
        settingsPath = Path.Combine(appDataDirectory, "theme.txt");
        recentFiles = new RecentFilesStore(Path.Combine(appDataDirectory, "recent-files.json"));
        InitializeComponent();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Marklane.ico"));
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1200, 860));
        AppWindow.Closing += OnClosing;
        OutlineList.ItemsSource = headings;
        ApplyTheme(File.Exists(settingsPath) && File.ReadAllText(settingsPath) == "dark");
    }

    private void ApplyTheme(bool dark)
    {
        Root.RequestedTheme = dark ? ElementTheme.Dark : ElementTheme.Light;
        NightModeMenu.IsChecked = dark;
        ThemeIcon.Glyph = dark ? "\uE706" : "\uE708";
        var label = dark ? "Switch to light mode" : "Switch to night mode";
        ToolTipService.SetToolTip(ThemeButton, label);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(ThemeButton, label);

        var foreground = dark ? Windows.UI.Color.FromArgb(255, 197, 203, 210) : Windows.UI.Color.FromArgb(255, 52, 58, 54);
        AppWindow.TitleBar.ButtonBackgroundColor = Microsoft.UI.Colors.Transparent;
        AppWindow.TitleBar.ButtonInactiveBackgroundColor = Microsoft.UI.Colors.Transparent;
        AppWindow.TitleBar.ButtonForegroundColor = foreground;
        AppWindow.TitleBar.ButtonHoverForegroundColor = foreground;
        AppWindow.TitleBar.ButtonHoverBackgroundColor = dark ? Windows.UI.Color.FromArgb(255, 69, 76, 84) : Windows.UI.Color.FromArgb(255, 226, 228, 223);
        AppWindow.TitleBar.ButtonInactiveForegroundColor = Windows.UI.Color.FromArgb(255, 145, 153, 162);
        Send(new { type = "theme", dark });
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await recentFiles.LoadAsync();
            RefreshRecentFilesMenu();
            var dataDirectory = Path.Combine(appDataDirectory, "WebView2");
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, dataDirectory, new CoreWebView2EnvironmentOptions());
            await Editor.EnsureCoreWebView2Async(environment);
            Editor.CoreWebView2.SetVirtualHostNameToFolderMapping("marklane.local", Path.Combine(AppContext.BaseDirectory, "Editor"), CoreWebView2HostResourceAccessKind.DenyCors);
            Editor.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            Editor.CoreWebView2.Settings.IsStatusBarEnabled = false;
            Editor.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            Editor.CoreWebView2.NavigationStarting += (_, args) => args.Cancel = args.Uri != EditorUrl;
            Editor.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess) return;
                LoadingRing.IsActive = false;
                LoadingText.Text = $"Couldn't load the local editor ({args.WebErrorStatus}). Rebuild Marklane to restore its editor assets.";
            };
            Editor.CoreWebView2.NewWindowRequested += (_, args) => args.Handled = true;
            Editor.CoreWebView2.WebMessageReceived += OnEditorMessage;
            var argument = Environment.GetCommandLineArgs().Skip(1).FirstOrDefault();
            if (argument is not null && File.Exists(argument))
            {
                await document.OpenAsync(argument);
                await RecordRecentFileAsync(argument);
            }
            else
                document.New(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Assets", "Welcome.md")));
            Editor.Source = new Uri(EditorUrl);
        }
        catch (Exception error)
        {
            LoadingRing.IsActive = false;
            LoadingText.Text = $"Couldn't start the editor. Ensure Microsoft Edge WebView2 Runtime is installed.\n\n{error.Message}";
        }
    }

    private async void OnEditorMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source != EditorUrl) return;
        try
        {
            using var message = JsonDocument.Parse(args.WebMessageAsJson);
            var root = message.RootElement;
            switch (root.GetProperty("type").GetString())
            {
                case "ready":
                    ready = true;
                    LoadingPanel.Visibility = Visibility.Collapsed;
                    ApplyTheme(Root.RequestedTheme == ElementTheme.Dark);
                    SendDocument();
                    break;
                case "change":
                    document.Text = root.GetProperty("text").GetString() ?? "";
                    UpdateStatus();
                    break;
                case "stats":
                    var count = root.GetProperty("words").GetInt32();
                    WordStatus.Text = $"{count:N0} {(count == 1 ? "word" : "words")} · {Math.Max(1, (int)Math.Ceiling(count / 220.0))} min read";
                    headings.Clear();
                    foreach (var heading in root.GetProperty("headings").EnumerateArray())
                        headings.Add(new HeadingItem(heading.GetProperty("title").GetString() ?? "", heading.GetProperty("position").GetInt32(), heading.GetProperty("level").GetInt32()));
                    break;
                case "command":
                    await RunCommandAsync(root.GetProperty("command").GetString() ?? "");
                    break;
            }
        }
        catch (Exception error) { await ShowErrorAsync(error); }
    }

    private void Send(object message)
    {
        if (ready) Editor.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    private void SendDocument()
    {
        Send(new { type = "load", text = document.Text });
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        Title = $"{(document.IsDirty ? "● " : "")}{document.Name} — Marklane";
        TitleText.Text = $"{document.Name}{(document.IsDirty ? " •" : "")}";
        SaveStatus.Text = document.IsDirty ? "Unsaved changes" : document.FilePath is null ? "New document" : "Saved";
        EncodingStatus.Text = $"{document.EncodingLabel} · {document.NewlineLabel}";
    }

    private async void OnCommand(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string command }) await RunCommandAsync(command);
    }

    private async Task RunCommandAsync(string command, string? recentPath = null)
    {
        if (busy || (!ready && command != "about")) return;
        busy = true;
        try
        {
            switch (command)
            {
                case "about": await ShowAboutAsync(); break;
                case "new":
                    await SynchronizeAsync();
                    if (await ConfirmDiscardAsync()) { document.New(); SendDocument(); }
                    break;
                case "open":
                    var picker = new FileOpenPicker();
                    InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
                    foreach (var extension in new[] { ".md", ".markdown", ".mdown", ".txt" }) picker.FileTypeFilter.Add(extension);
                    var file = await picker.PickSingleFileAsync();
                    if (file is not null) await SwitchToFileAsync(file.Path);
                    break;
                case "openRecent":
                    if (recentPath is not null) await SwitchToFileAsync(recentPath, fromRecentFiles: true);
                    break;
                case "clearRecent":
                    var cleared = await recentFiles.ClearAsync();
                    RefreshRecentFilesMenu();
                    if (!cleared) SaveStatus.Text = "Recent files could not be cleared on disk";
                    break;
                case "save": await SaveAsync(false); break;
                case "saveAs": await SaveAsync(true); break;
                case "source":
                    sourceMode = !sourceMode;
                    SourceButton.IsChecked = sourceMode;
                    ModeStatus.Text = sourceMode ? "Markdown source" : "Live preview";
                    Send(new { type = "source", enabled = sourceMode });
                    break;
                case "outline": showOutline = !showOutline; UpdateSidebar(); break;
                case "focus":
                    SetFocusMode(!focusMode);
                    break;
                case "exitFocus":
                    SetFocusMode(false);
                    break;
                case "theme":
                    ApplyTheme(Root.RequestedTheme != ElementTheme.Dark);
                    Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
                    await File.WriteAllTextAsync(settingsPath, Root.RequestedTheme == ElementTheme.Dark ? "dark" : "light");
                    break;
                default: Send(new { type = "command", command }); break;
            }
        }
        catch (Exception error) { await ShowErrorAsync(error); }
        finally { busy = false; }
    }

    private async Task SwitchToFileAsync(string path, bool fromRecentFiles = false)
    {
        await SynchronizeAsync();
        if (!await ConfirmDiscardAsync()) return;
        try
        {
            await document.OpenAsync(path);
        }
        catch (Exception error) when (fromRecentFiles && (error is FileNotFoundException or DirectoryNotFoundException))
        {
            await recentFiles.RemoveAsync(path);
            RefreshRecentFilesMenu();
            throw;
        }
        SendDocument();
        await RecordRecentFileAsync(path);
    }

    private async Task RecordRecentFileAsync(string path)
    {
        var saved = await recentFiles.RecordAsync(path);
        RefreshRecentFilesMenu();
        if (!saved) SaveStatus.Text = "Document ready · Recent files could not be saved";
    }

    private void RefreshRecentFilesMenu()
    {
        RecentFilesMenu.Items.Clear();
        if (recentFiles.Files.Count == 0)
        {
            RecentFilesMenu.Items.Add(new MenuFlyoutItem { Text = "No recent files", IsEnabled = false });
            return;
        }
        for (var index = 0; index < recentFiles.Files.Count; index++)
        {
            var path = recentFiles.Files[index];
            var item = new MenuFlyoutItem
            {
                Text = $"{Path.GetFileName(path)} — {Path.GetDirectoryName(path)}",
                Tag = path,
                MaxWidth = 600
            };
            ToolTipService.SetToolTip(item, path);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(item, $"Open recent file {path}");
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(item, $"RecentFile{index}");
            item.Click += OnRecentFileClick;
            RecentFilesMenu.Items.Add(item);
        }
        RecentFilesMenu.Items.Add(new MenuFlyoutSeparator());
        var clear = new MenuFlyoutItem { Text = "Clear recent files", Tag = "clearRecent" };
        clear.Click += OnCommand;
        RecentFilesMenu.Items.Add(clear);
    }

    private async void OnRecentFileClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string path }) await RunCommandAsync("openRecent", path);
    }

    // Flush the current editor snapshot before save/close, including edits whose messages are still queued.
    private async Task SynchronizeAsync()
    {
        var json = await Editor.CoreWebView2.ExecuteScriptAsync("window.marklane.getText()");
        document.Text = JsonSerializer.Deserialize<string>(json) ?? throw new InvalidOperationException("The editor did not return its document.");
    }

    private async Task<bool> SaveAsync(bool saveAs)
    {
        await SynchronizeAsync();
        var path = document.FilePath;
        if (saveAs || path is null)
        {
            var picker = new FileSavePicker { SuggestedFileName = document.Name };
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
            picker.FileTypeChoices.Add("Markdown", new List<string> { ".md" });
            var file = await picker.PickSaveFileAsync();
            if (file is null) return false;
            path = file.Path;
        }
        await document.SaveAsync(path);
        UpdateStatus();
        await RecordRecentFileAsync(path);
        return true;
    }

    private async Task<bool> ConfirmDiscardAsync()
    {
        if (!document.IsDirty) return true;
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            RequestedTheme = Root.RequestedTheme,
            Title = "Save your changes?",
            Content = $"Keep the changes to {document.Name} before continuing?",
            PrimaryButtonText = "Save",
            SecondaryButtonText = "Don't save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary
        };
        return await dialog.ShowAsync() switch
        {
            ContentDialogResult.Primary => await SaveAsync(false),
            ContentDialogResult.Secondary => true,
            _ => false
        };
    }

    private async void OnClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (allowClose || !ready) return;
        args.Cancel = true;
        if (busy) return;
        busy = true;
        try
        {
            await SynchronizeAsync();
            if (await ConfirmDiscardAsync())
            {
                allowClose = true;
                Editor.Close();
                Close();
            }
        }
        catch (Exception error) { await ShowErrorAsync(error); }
        finally { busy = false; }
    }

    private void SetFocusMode(bool enabled)
    {
        focusMode = enabled;
        Toolbar.Visibility = enabled ? Visibility.Collapsed : Visibility.Visible;
        StatusBar.Visibility = enabled ? Visibility.Collapsed : Visibility.Visible;
        StatusBarRow.Height = new GridLength(enabled ? 0 : 32);
        UpdateSidebar();
        Editor.Focus(FocusState.Programmatic);
        Send(new { type = "focus", enabled });
    }

    private void UpdateSidebar()
    {
        var visible = showOutline && !focusMode;
        Sidebar.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        SidebarColumn.Width = new GridLength(visible ? 224 : 0);
    }

    private void OnHeadingClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is HeadingItem heading) Send(new { type = "jump", position = heading.Position });
    }

    private async Task ShowAboutAsync()
    {
        var assembly = typeof(App).Assembly;
        var version = assembly.GetName().Version!.ToString(3);
        var author = assembly.GetCustomAttribute<AssemblyCompanyAttribute>()!.Company;
        var copyright = assembly.GetCustomAttribute<AssemblyCopyrightAttribute>()!.Copyright;
        await new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            RequestedTheme = Root.RequestedTheme,
            Title = "About Marklane",
            Content = $"Version {version}\n\nA quiet Markdown editor for Windows.\n\nCreated by {author}\n{copyright}",
            CloseButtonText = "Close",
            DefaultButton = ContentDialogButton.Close
        }.ShowAsync();
    }

    private async Task ShowErrorAsync(Exception error)
    {
        await new ContentDialog
        {
            XamlRoot = Root.XamlRoot, RequestedTheme = Root.RequestedTheme,
            Title = "Couldn't complete that action", Content = error.Message, CloseButtonText = "OK"
        }.ShowAsync();
    }
}

public sealed record HeadingItem(string Title, int Position, int Level)
{
    public Thickness Indent => new(Math.Max(0, Level - 1) * 12, 0, 0, 0);
}
