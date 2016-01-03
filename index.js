/*** InfluxDbStats Z-Way HA module *******************************************

Version: 1.00
(c) Maroš Kollár, 2015
-----------------------------------------------------------------------------
Author: Maroš Kollár <maros@k-1.com>
Description:
    Collects sensor stats in an InfluxDB

******************************************************************************/

// ----------------------------------------------------------------------------
// --- Class definition, inheritance and setup
// ----------------------------------------------------------------------------

function InfluxDbStats (id, controller) {
    // Call superconstructor first (AutomationModule)
    InfluxDbStats.super_.call(this, id, controller);
    
    this.interval       = undefined;
    this.url            = undefined;
    this.langfile       = undefined;
    this.commandClass   = 0x80;
}

inherits(InfluxDbStats, BaseModule);

_module = InfluxDbStats;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

InfluxDbStats.prototype.init = function (config) {
    InfluxDbStats.super_.prototype.init.call(this, config);
    var self = this;
    
    self.url = self.config.server
        + ':'
        + self.config.port
        + '/write'
        + '?db='
        + encodeURIComponent(self.config.database);
    
    if (typeof(self.config.username) !== 'undefined') {
        self.url = self.url + '&u=' + encodeURIComponent(self.config.username);
    }
    if (typeof(self.config.password) !== 'undefined') {
        self.url = self.url + '&p=' + encodeURIComponent(self.config.password);
    }
    
    if (typeof(self.config.interval) !== 'undefined') {
        var interval = parseInt(self.config.interval,10) * 60 * 1000;
        self.interval = setInterval(_.bind(self.updateAll,self), interval);
    }
    
    self.handleUpdate = _.bind(self.updateDevice,self);
    // Bind on metrics:changeTime to get only real updates
    self.controller.devices.on("change:metrics:changeTime",self.handleUpdate);
};

InfluxDbStats.prototype.stop = function () {
    var self = this;
    
    // Remove interval
    if (typeof(self.interval) !== 'undefined') {
        clearInterval(self.interval);
    }
    
    // Remove listener
    self.controller.devices.off("change:metrics:level",self.handleUpdate);
    self.handleUpdate = undefined;
    
    InfluxDbStats.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

InfluxDbStats.prototype.updateDevice = function (vDev) {
    var self = this;
    
    if (typeof(vDev) === 'undefined') {
        self.error('Invalid event');
        return;
    }
    
    if (_.intersection(vDev.get('tags'), self.config.tags).length > 0) {
        self.log('Update device '+vDev.id);
        var lines = [
            self.collectVirtualDevice(vDev)
        ];
        setTimeout(_.bind(self.sendStats,self,lines),1);
    }
};

InfluxDbStats.prototype.escapeValue = function (value) {
    var self = this;
    
    switch(typeof(value)) {
        case 'number':
            return value;
        case 'string':
            return value.replace(/(,|\s+)/g, '\\$1');
    }
    return 'null';
};


InfluxDbStats.prototype.collectVirtualDevice = function (deviceObject) {
    var self    = this;
    
    var level           = deviceObject.get('metrics:level');
    var scale           = deviceObject.get('metrics:scaleTitle');
    var probe           = deviceObject.get('metrics:probeTitle') || deviceObject.get('probeType');
    var title           = deviceObject.get('metrics:title');
    var location        = parseInt(deviceObject.get('location'),10);
    var type            = deviceObject.get('deviceType');
    var room            = _.find(
        self.controller.locations, 
        function(item){ return (item.id === location); }
    );
    if (typeof(room) === 'object') {
        room = room.title;
    }
    
    return 'device.' + self.escapeValue(deviceObject.id) +
        ',probe=' + self.escapeValue(probe) +
        ',room=' + self.escapeValue(room) +
        ',scale=' + self.escapeValue(scale) +
        ',title=' + self.escapeValue(title) +
        ',type=' + type +
        ' level=' + self.escapeValue(level);
};

InfluxDbStats.prototype.collectZwaveDevice = function (deviceIndex,device) {
    var self    = this;
    if (typeof(device) === 'undefined') {
        return;
    }
    
    var deviceData  = device.data;
    var batteryData = device.instances[0].commandClasses[self.commandClass.toString()];
    
    return 'zwave.' + self.escapeValue(deviceIndex) +
        ',title=' + self.escapeValue(deviceData.givenName.value) + // Tags
        ',type=' + self.escapeValue(deviceData.basicType.value) +
        ' failed=' + self.escapeValue(deviceData.countFailed.value) + // Values
        ',failure=' + self.escapeValue(deviceData.failureCount.value) +
        ',success=' + self.escapeValue(deviceData.countSuccess.value) +
        ',queue=' + self.escapeValue(deviceData.queueLength.value) +
        (typeof(batteryData) !== 'undefined' ? ',battery=' + self.escapeValue(batteryData.data.last.value) : '');
};

InfluxDbStats.prototype.updateAll = function () {
    var self = this;
    
    self.log('Update all');
    var lines = [];
    
    self.controller.devices.each(function(vDev) {
        var tags = vDev.get('tags');
        if (_.intersection(tags, self.config.tags).length > 0) {
            lines.push(self.collectVirtualDevice(vDev));
        }
    });
    
    if (global.ZWave) {
        for (var zwayName in global.ZWave) {
            var zway = global.ZWave && global.ZWave[zwayName].zway;
            if (zway) {
                for(var deviceIndex in zway.devices) {
                    if (deviceIndex !== 1) {
                        lines.push(self.collectZwaveDevice(deviceIndex,zway.devices[deviceIndex]));
                    }
                }
            }
        }
    }
    
    self.sendStats(lines);
};

InfluxDbStats.prototype.sendStats = function (lines) {
    var self = this;
    
    if (lines.length === 0) {
        return;
    }
    var data = lines.join("\n");
    
    http.request({
        url:    self.url,
        async:  true,
        method: 'POST',
        data:   data,
        error:  function(response) {
            console.error('[InfluxDb] Could not post stats');
            console.logJS(response);
            
            self.controller.addNotification(
                "error", 
                self.langFile.error,
                "module", 
                "InfluxDbStats"
            );
        }
    });
};
