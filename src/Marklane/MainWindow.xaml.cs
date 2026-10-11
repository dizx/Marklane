using System.Collections.ObjectModel;
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
    private readonly string settingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marklane", "theme.txt");

    public MainWindow()
    {
        InitializeComponent();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Marklane.ico"));
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1200, 860));
        AppWindow.Closing += OnClosing;
        OutlineList.ItemsSource = headings;
        Root.RequestedTheme = File.Exists(settingsPath) && File.ReadAllText(settingsPath) == "dark"
            ? ElementTheme.Dark : ElementTheme.Light;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Marklane", "WebView2");
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
                await document.OpenAsync(argument);
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
                    SendDocument();
                    Send(new { type = "theme", dark = Root.RequestedTheme == ElementTheme.Dark });
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

    private async Task RunCommandAsync(string command)
    {
        if (!ready || busy) return;
        busy = true;
        try
        {
            switch (command)
            {
                case "new":
                    await SynchronizeAsync();
                    if (await ConfirmDiscardAsync()) { document.New(); SendDocument(); }
                    break;
                case "open":
                    await SynchronizeAsync();
                    if (!await ConfirmDiscardAsync()) break;
                    var picker = new FileOpenPicker();
                    InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
                    foreach (var extension in new[] { ".md", ".markdown", ".mdown", ".txt" }) picker.FileTypeFilter.Add(extension);
                    var file = await picker.PickSingleFileAsync();
                    if (file is not null) { await document.OpenAsync(file.Path); SendDocument(); }
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
                    focusMode = !focusMode;
                    UpdateSidebar();
                    Send(new { type = "focus", enabled = focusMode });
                    break;
                case "theme":
                    Root.RequestedTheme = Root.RequestedTheme == ElementTheme.Dark ? ElementTheme.Light : ElementTheme.Dark;
                    Send(new { type = "theme", dark = Root.RequestedTheme == ElementTheme.Dark });
                    Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
                    await File.WriteAllTextAsync(settingsPath, Root.RequestedTheme == ElementTheme.Dark ? "dark" : "light");
                    break;
                default: Send(new { type = "command", command }); break;
            }
        }
        catch (Exception error) { await ShowErrorAsync(error); }
        finally { busy = false; }
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
